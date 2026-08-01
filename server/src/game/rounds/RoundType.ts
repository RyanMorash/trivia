import type { Command, Role, RoundStateView } from '@trivia/shared';

/** Thrown by handlers/engine for invalid commands; message goes back in the socket ack. */
export class CommandError extends Error {}

export interface Actor {
  role: Role;
  /** Set for competitor sockets. */
  teamId?: number;
}

/**
 * The engine surface a round handler can touch. Handlers never talk to the DB
 * or sockets directly — scoring goes through addScore (which feeds the
 * score_events ledger) and buzzing through the arbiter methods.
 */
export interface EngineCtx {
  addScore(teamId: number, delta: number, reason: string, questionId?: number | null): void;
  activeTeamIds(): number[];
  teamScore(teamId: number): number;
  openBuzzers(eligibleTeamIds: number[]): void;
  closeBuzzers(): void;
  resetBuzz(): void;
  currentAnsweringTeamId(): number | null;
}

/**
 * A pluggable round type. Implementations own their internal (unfiltered)
 * state; `view` produces the role-filtered projection that goes into
 * snapshots. Adding a round type = implement this + register in
 * rounds/index.ts + add renderers in the web app.
 */
export interface RoundHandler {
  readonly type: string;

  /** Apply a role-validated command. Throw CommandError for invalid transitions. */
  handleCommand(cmd: Command, actor: Actor, ctx: EngineCtx): void;

  /** Called when the buzz arbiter accepts the first buzz of a race. */
  onFirstBuzz(teamId: number, ctx: EngineCtx): void;

  isComplete(): boolean;

  view(role: Role, teamId?: number): RoundStateView;
}
