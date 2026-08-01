import type { RoundType, SessionStatus } from './models.js';

// Live game state as seen by clients. The server holds the authoritative
// version and broadcasts role-filtered snapshots — answers and host notes are
// stripped for competitor/audience views (fields become null).

export type Role = 'showrunner' | 'host' | 'competitor' | 'audience';

export interface TeamState {
  id: number;
  name: string;
  score: number;
  connected: boolean;
}

export interface BuzzEntry {
  teamId: number;
  order: number;
}

export interface BuzzState {
  open: boolean;
  queue: BuzzEntry[];
  lockedTeamIds: number[];
  answeringTeamId: number | null;
}

/** A question as shown in a snapshot. answer/notes are null unless the viewer is host/showrunner. */
export interface ClueView {
  questionId: number;
  categoryName: string;
  prompt: string;
  value: number;
  answer: string | null;
  notes: string | null;
}

export type JudgingPhase =
  | 'round-intro'
  | 'idle'
  | 'clue-shown'
  | 'buzzing-open'
  | 'judging'
  | 'answer-reveal'
  | 'round-complete';

export interface BoardCellView {
  questionId: number;
  value: number;
  used: boolean;
}

export interface BoardCategoryView {
  categoryId: number;
  name: string;
  cells: BoardCellView[];
}

export interface BoardRoundState {
  type: 'board';
  phase: JudgingPhase;
  board: BoardCategoryView[];
  currentClue: ClueView | null;
  /** Set during answer-reveal — visible to every role. */
  revealedAnswer: string | null;
  /** Whether wrong answers deduct points (from config, shown to host). */
  wrongAnswerPenalty: boolean;
}

export interface QuickfireRoundState {
  type: 'quickfire';
  phase: JudgingPhase;
  questionIndex: number;
  totalQuestions: number;
  currentClue: ClueView | null;
  revealedAnswer: string | null;
  pointsPerQuestion: number;
  wrongAnswerPenalty: number;
}

export type WagerPhase =
  | 'round-intro'
  | 'wager-collect'
  | 'clue-shown'
  | 'answer-collect'
  | 'reveal'
  | 'round-complete';

export type WagerRevealStage = 'hidden' | 'answer-shown' | 'judged' | 'wager-shown';

export interface WagerTeamView {
  teamId: number;
  wagerSubmitted: boolean;
  /** null while hidden from this role (competitors/audience see it only once revealed). */
  wager: number | null;
  answerSubmitted: boolean;
  answer: string | null;
  judged: 'correct' | 'incorrect' | null;
  revealStage: WagerRevealStage;
  /** Maximum wager allowed for this team, computed when wager-collect opens. */
  maxWager: number;
}

export interface WagerRoundState {
  type: 'wager';
  phase: WagerPhase;
  /** Category/topic teased during wager-collect, before the clue itself is shown. */
  topic: string;
  clue: ClueView | null;
  teams: WagerTeamView[];
  /** Team currently being stepped through during the reveal phase. */
  currentRevealTeamId: number | null;
}

export type RoundStateView = BoardRoundState | QuickfireRoundState | WagerRoundState;

export interface RoundSummary {
  title: string;
  type: RoundType;
}

export interface GameSnapshot {
  sessionCode: string;
  gameName: string;
  status: SessionStatus;
  /** -1 while in lobby. */
  roundIndex: number;
  rounds: RoundSummary[];
  teams: TeamState[];
  buzz: BuzzState | null;
  round: RoundStateView | null;
  /** Monotonic per-session sequence; clients ignore snapshots older than the last seen. */
  seq: number;
}
