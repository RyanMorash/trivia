import {
  ROLE_COMMANDS,
  type BuzzAcceptedEvent,
  type BuzzerSeenEvent,
  type BuzzResult,
  type Command,
  type GameRound,
  type GameSnapshot,
  type Role,
  type SessionWithKeys,
  type TeamState,
  type ToastEvent,
} from '@trivia/shared';
import type { ContentRepo } from '../db/repos/contentRepo.js';
import type { EventRepo } from '../db/repos/eventRepo.js';
import type { SessionRepo } from '../db/repos/sessionRepo.js';
import { BuzzArbiter } from './buzzArbiter.js';
import { createRoundHandler } from './rounds/index.js';
import { CommandError, type Actor, type EngineCtx, type RoundHandler } from './rounds/RoundType.js';

export interface EngineDeps {
  content: ContentRepo;
  sessions: SessionRepo;
  events: EventRepo;
  emitter: EngineEmitter;
}

/** Implemented by the sockets layer; the engine never touches Socket.IO directly. */
export interface EngineEmitter {
  broadcast(engine: GameEngine): void;
  buzzAccepted(code: string, ev: BuzzAcceptedEvent): void;
  buzzerSeen(code: string, ev: BuzzerSeenEvent): void;
  toastShowrunner(code: string, ev: ToastEvent): void;
}

interface InternalTeam {
  id: number;
  name: string;
  sortOrder: number;
  active: boolean;
  score: number;
  connections: number;
}

/**
 * One GameEngine per live session. Owns the authoritative state, journals
 * every accepted command/buzz to game_events (sync — better-sqlite3), and
 * asks the emitter to re-broadcast role-filtered snapshots after each change.
 * Restart recovery = replaying the journal (see registry.ts).
 */
export class GameEngine {
  readonly session: SessionWithKeys;
  private gameName: string;
  private rounds: GameRound[];
  private teams: InternalTeam[] = [];
  private mappings = new Map<string, number>();
  private status: 'lobby' | 'live' | 'finished';
  private roundIndex = -1;
  private handler: RoundHandler | null = null;
  private arbiter = new BuzzArbiter();
  private journalSeq = 0;
  private snapshotSeq = 0;
  private replaying = false;

  constructor(
    private deps: EngineDeps,
    session: SessionWithKeys,
  ) {
    this.session = session;
    this.status = session.status;
    const game = deps.content.getGame(session.gameId);
    this.gameName = game?.name ?? 'Untitled game';
    this.rounds = deps.content.listRounds(session.gameId);
    this.journalSeq = deps.events.lastSeq(session.id);
    // Snapshots are only compared within one socket connection (delivery is
    // ordered), but seed past the journal anyway so seq stays monotonic-ish
    // across restarts.
    this.snapshotSeq = this.journalSeq;
    this.loadTeams();
  }

  get code(): string {
    return this.session.code;
  }

  private loadTeams(): void {
    const ledger = this.deps.sessions.scoreTotals(this.session.id);
    const existing = new Map(this.teams.map((t) => [t.id, t]));
    this.teams = this.deps.sessions.listTeams(this.session.id).map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
      active: t.active,
      score: existing.get(t.id)?.score ?? ledger.get(t.id) ?? 0,
      connections: existing.get(t.id)?.connections ?? 0,
    }));
    this.mappings = new Map(
      this.deps.sessions.listMappings(this.session.id).map((m) => [m.buzzerId, m.teamId]),
    );
  }

  /** Called by the REST layer after team/mapping mutations. */
  refreshRoster(): void {
    this.loadTeams();
    this.broadcast();
  }

  // ---- engine context handed to round handlers ------------------------------

  private ctx: EngineCtx = {
    addScore: (teamId, delta, reason, questionId = null) => {
      const team = this.teams.find((t) => t.id === teamId);
      if (!team) return;
      team.score += delta;
      if (!this.replaying) {
        this.deps.sessions.addScoreEvent(this.session.id, teamId, delta, reason, this.roundIndex, questionId);
      }
    },
    activeTeamIds: () => this.teams.filter((t) => t.active).map((t) => t.id),
    teamScore: (teamId) => this.teams.find((t) => t.id === teamId)?.score ?? 0,
    openBuzzers: (eligible) =>
      this.arbiter.open(
        eligible,
        this.teams.filter((t) => t.active).map((t) => t.id),
      ),
    closeBuzzers: () => this.arbiter.close(),
    resetBuzz: () => this.arbiter.reset(),
    currentAnsweringTeamId: () => this.arbiter.state()?.answeringTeamId ?? null,
  };

  // ---- command dispatch -----------------------------------------------------

  dispatch(cmd: Command, actor: Actor): void {
    const allowed = ROLE_COMMANDS[actor.role];
    if (allowed !== 'all' && !allowed.includes(cmd.type)) {
      throw new CommandError(`Role ${actor.role} may not use ${cmd.type}`);
    }
    this.apply(cmd, actor);
    this.journal('cmd', { cmd, actor: { role: actor.role, teamId: actor.teamId ?? null } });
    this.broadcast();
  }

  private apply(cmd: Command, actor: Actor): void {
    switch (cmd.type) {
      case 'startGame':
        if (this.status !== 'lobby') throw new CommandError('Game already started');
        if (this.teams.filter((t) => t.active).length === 0) {
          throw new CommandError('Add at least one team first');
        }
        this.setStatus('live');
        break;

      case 'startRound': {
        if (this.status !== 'live') throw new CommandError('Game is not live');
        const round = this.rounds[cmd.roundIndex];
        if (!round) throw new CommandError('No such round');
        this.roundIndex = cmd.roundIndex;
        this.handler = createRoundHandler(round.config, this.deps.content);
        this.arbiter.reset();
        break;
      }

      case 'nextRound': {
        if (this.status !== 'live') throw new CommandError('Game is not live');
        const next = this.roundIndex + 1;
        if (next >= this.rounds.length) {
          throw new CommandError('No more rounds — use End Game');
        }
        this.apply({ type: 'startRound', roundIndex: next }, actor);
        break;
      }

      case 'endGame':
        if (this.status !== 'live') throw new CommandError('Game is not live');
        this.setStatus('finished');
        this.handler = null;
        this.arbiter.reset();
        break;

      case 'adjustScore':
        this.ctx.addScore(cmd.teamId, cmd.delta, `adjustment: ${cmd.reason || 'manual'}`);
        break;

      default:
        if (!this.handler) throw new CommandError('No round in progress');
        this.handler.handleCommand(cmd, actor, this.ctx);
    }
  }

  private setStatus(status: 'lobby' | 'live' | 'finished'): void {
    this.status = status;
    if (!this.replaying) this.deps.sessions.setStatus(this.session.id, status);
  }

  // ---- buzz ingest ----------------------------------------------------------

  ingestBuzz(buzzerId: string): BuzzResult {
    const teamId = this.mappings.get(buzzerId);
    this.deps.emitter.buzzerSeen(this.code, { buzzerId, mappedTeamId: teamId ?? null });
    if (teamId === undefined) {
      this.deps.emitter.toastShowrunner(this.code, {
        level: 'warn',
        msg: `Unmapped buzzer "${buzzerId}" pressed`,
      });
      return { accepted: false, reason: 'unmapped' };
    }
    return this.applyBuzz(teamId);
  }

  private applyBuzz(teamId: number): BuzzResult {
    const result = this.arbiter.buzz(teamId);
    if (!result.accepted) return result;
    if (!this.replaying) {
      this.journal('buzz', { teamId });
      this.deps.emitter.buzzAccepted(this.code, { teamId, order: result.order! });
    }
    if (result.first && this.handler) {
      this.handler.onFirstBuzz(teamId, this.ctx);
    }
    this.broadcast();
    return { accepted: result.accepted, order: result.order };
  }

  // ---- journaling + recovery ------------------------------------------------

  /**
   * Journal an applied transition. A write failure (disk full, locked DB)
   * must not desync clients from the applied in-memory state, so it never
   * throws — but the operator is warned that restart recovery is no longer
   * trustworthy.
   */
  private journal(type: string, payload: unknown): void {
    if (this.replaying) return;
    this.journalSeq += 1;
    try {
      this.deps.events.append(this.session.id, this.journalSeq, type, payload);
    } catch (err) {
      console.error(`[journal] session ${this.code} seq ${this.journalSeq} write failed`, err);
      this.deps.emitter.toastShowrunner(this.code, {
        level: 'error',
        msg: 'Journal write failed — the game continues, but crash recovery may lose this step',
      });
    }
  }

  replayJournal(): void {
    this.replaying = true;
    // Replay from the session's initial state; the journal carries every
    // transition since creation (status writes are not persisted during replay).
    this.status = 'lobby';
    this.roundIndex = -1;
    this.handler = null;
    try {
      for (const ev of this.deps.events.listForSession(this.session.id)) {
        try {
          if (ev.type === 'cmd') {
            const { cmd, actor } = ev.payload as { cmd: Command; actor: { role: Role; teamId: number | null } };
            this.apply(cmd, { role: actor.role, teamId: actor.teamId ?? undefined });
          } else if (ev.type === 'buzz') {
            const { teamId } = ev.payload as { teamId: number };
            this.applyBuzz(teamId);
          }
        } catch (err) {
          console.warn(`[recovery] session ${this.code} seq ${ev.seq}: skipped (${(err as Error).message})`);
        }
      }
    } finally {
      this.replaying = false;
    }
    // The ledger is authoritative for scores regardless of replay results.
    const ledger = this.deps.sessions.scoreTotals(this.session.id);
    for (const team of this.teams) {
      team.score = ledger.get(team.id) ?? 0;
    }
  }

  // ---- connection tracking --------------------------------------------------

  teamConnected(teamId: number, delta: 1 | -1): void {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return;
    team.connections = Math.max(0, team.connections + delta);
    this.broadcast();
  }

  // ---- snapshots ------------------------------------------------------------

  private broadcast(): void {
    if (this.replaying) return;
    this.snapshotSeq += 1;
    this.deps.emitter.broadcast(this);
  }

  snapshot(role: Role, viewerTeamId?: number): GameSnapshot {
    const teams: TeamState[] = this.teams
      .filter((t) => t.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((t) => ({ id: t.id, name: t.name, score: t.score, connected: t.connections > 0 }));
    return {
      sessionCode: this.code,
      gameName: this.gameName,
      status: this.status,
      roundIndex: this.roundIndex,
      rounds: this.rounds.map((r) => ({ title: r.title, type: r.roundType })),
      teams,
      buzz: this.arbiter.state(),
      round: this.handler ? this.handler.view(role, viewerTeamId) : null,
      seq: this.snapshotSeq,
    };
  }
}
