import { customAlphabet } from 'nanoid';
import type { BuzzerMapping, Session, SessionStatus, SessionWithKeys, Team } from '@trivia/shared';
import type { DB } from '../connection.js';

// Unambiguous alphabet for join codes (no 0/O, 1/I/L).
const codeGen = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 4);
const keyGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20);

interface SessionRow {
  id: number;
  code: string;
  game_id: number;
  status: string;
  showrunner_key: string;
  host_key: string;
  created_at: string;
}
interface TeamRow {
  id: number;
  session_id: number;
  name: string;
  sort_order: number;
  active: number;
}
interface MappingRow {
  id: number;
  session_id: number;
  buzzer_id: string;
  team_id: number;
}

const toSession = (r: SessionRow): SessionWithKeys => ({
  id: r.id,
  code: r.code,
  gameId: r.game_id,
  status: r.status as SessionStatus,
  showrunnerKey: r.showrunner_key,
  hostKey: r.host_key,
  createdAt: r.created_at,
});
export const publicSession = (s: SessionWithKeys): Session => ({
  id: s.id,
  code: s.code,
  gameId: s.gameId,
  status: s.status,
  createdAt: s.createdAt,
});
const toTeam = (r: TeamRow): Team => ({
  id: r.id,
  sessionId: r.session_id,
  name: r.name,
  sortOrder: r.sort_order,
  active: r.active === 1,
});
const toMapping = (r: MappingRow): BuzzerMapping => ({
  id: r.id,
  sessionId: r.session_id,
  buzzerId: r.buzzer_id,
  teamId: r.team_id,
});

export class SessionRepo {
  constructor(private db: DB) {}

  create(gameId: number): SessionWithKeys {
    // Retry on the (unlikely) code collision.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const info = this.db
          .prepare('INSERT INTO sessions (code, game_id, showrunner_key, host_key) VALUES (?, ?, ?, ?)')
          .run(codeGen(), gameId, keyGen(), keyGen());
        return this.getById(Number(info.lastInsertRowid))!;
      } catch (err) {
        if (attempt === 9) throw err;
      }
    }
    throw new Error('unreachable');
  }

  getById(id: number): SessionWithKeys | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return r ? toSession(r) : null;
  }

  getByCode(code: string): SessionWithKeys | null {
    const r = this.db
      .prepare('SELECT * FROM sessions WHERE code = ?')
      .get(code.toUpperCase()) as SessionRow | undefined;
    return r ? toSession(r) : null;
  }

  list(): SessionWithKeys[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY id DESC').all() as SessionRow[]).map(toSession);
  }

  listUnfinished(): SessionWithKeys[] {
    return (
      this.db.prepare("SELECT * FROM sessions WHERE status != 'finished' ORDER BY id").all() as SessionRow[]
    ).map(toSession);
  }

  setStatus(id: number, status: SessionStatus): void {
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id);
  }

  // ---- teams ----------------------------------------------------------------

  listTeams(sessionId: number): Team[] {
    return (
      this.db.prepare('SELECT * FROM teams WHERE session_id = ? ORDER BY sort_order, id').all(sessionId) as TeamRow[]
    ).map(toTeam);
  }

  getTeam(id: number): Team | null {
    const r = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as TeamRow | undefined;
    return r ? toTeam(r) : null;
  }

  createTeam(sessionId: number, name: string, sortOrder: number): Team {
    const info = this.db
      .prepare('INSERT INTO teams (session_id, name, sort_order) VALUES (?, ?, ?)')
      .run(sessionId, name, sortOrder);
    return this.getTeam(Number(info.lastInsertRowid))!;
  }

  updateTeam(id: number, name: string, sortOrder: number, active: boolean): void {
    this.db
      .prepare('UPDATE teams SET name = ?, sort_order = ?, active = ? WHERE id = ?')
      .run(name, sortOrder, active ? 1 : 0, id);
  }

  deleteTeam(id: number): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }

  // ---- buzzer mappings ------------------------------------------------------

  listMappings(sessionId: number): BuzzerMapping[] {
    return (
      this.db.prepare('SELECT * FROM buzzer_mappings WHERE session_id = ?').all(sessionId) as MappingRow[]
    ).map(toMapping);
  }

  /** Insert or reassign a buzzer to a team. */
  setMapping(sessionId: number, buzzerId: string, teamId: number): BuzzerMapping {
    this.db
      .prepare(
        `INSERT INTO buzzer_mappings (session_id, buzzer_id, team_id) VALUES (?, ?, ?)
         ON CONFLICT(session_id, buzzer_id) DO UPDATE SET team_id = excluded.team_id`,
      )
      .run(sessionId, buzzerId, teamId);
    const r = this.db
      .prepare('SELECT * FROM buzzer_mappings WHERE session_id = ? AND buzzer_id = ?')
      .get(sessionId, buzzerId) as MappingRow;
    return toMapping(r);
  }

  deleteMapping(sessionId: number, buzzerId: string): void {
    this.db.prepare('DELETE FROM buzzer_mappings WHERE session_id = ? AND buzzer_id = ?').run(sessionId, buzzerId);
  }

  // ---- score ledger ---------------------------------------------------------

  addScoreEvent(
    sessionId: number,
    teamId: number,
    delta: number,
    reason: string,
    roundIndex: number | null,
    questionId: number | null,
  ): void {
    this.db
      .prepare(
        'INSERT INTO score_events (session_id, team_id, delta, reason, round_index, question_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(sessionId, teamId, delta, reason, roundIndex, questionId);
  }

  scoreTotals(sessionId: number): Map<number, number> {
    const rows = this.db
      .prepare('SELECT team_id, SUM(delta) AS total FROM score_events WHERE session_id = ? GROUP BY team_id')
      .all(sessionId) as { team_id: number; total: number }[];
    return new Map(rows.map((r) => [r.team_id, r.total]));
  }

  scoreHistory(sessionId: number): unknown[] {
    return this.db
      .prepare('SELECT * FROM score_events WHERE session_id = ? ORDER BY id DESC LIMIT 200')
      .all(sessionId);
  }
}
