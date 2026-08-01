// Content + composition models: these mirror the SQLite schema rows after JSON
// columns are parsed. Everything the editor UIs and REST API exchange.

export interface QuestionSet {
  id: number;
  name: string;
  description: string;
  createdAt: string;
}

export interface Category {
  id: number;
  questionSetId: number;
  name: string;
  sortOrder: number;
}

export interface Question {
  id: number;
  categoryId: number;
  sortOrder: number;
  prompt: string;
  answer: string;
  value: number;
  mediaUrl: string | null;
  notes: string | null;
}

export interface Game {
  id: number;
  name: string;
  createdAt: string;
}

export type RoundType = 'board' | 'quickfire' | 'wager';

export interface BoardRoundConfig {
  type: 'board';
  questionSetId: number;
  categoryIds: number[];
  /** Point values for row 1..n; questions are laid out per category in sortOrder. */
  values: number[];
  /** Deduct the clue value on a wrong answer (classic Jeopardy rule). */
  wrongAnswerPenalty: boolean;
}

export interface QuickfireRoundConfig {
  type: 'quickfire';
  questionSetId: number;
  categoryIds: number[];
  pointsPerQuestion: number;
  /** Points deducted on a wrong answer (0 = no penalty). */
  wrongAnswerPenalty: number;
}

export interface WagerRoundConfig {
  type: 'wager';
  questionId: number;
  /** 'all-in': wager up to max(score, 0); 'cap': wager up to `cap`. */
  maxWagerRule: 'all-in' | 'cap';
  cap?: number;
}

export type RoundConfig = BoardRoundConfig | QuickfireRoundConfig | WagerRoundConfig;

export interface GameRound {
  id: number;
  gameId: number;
  sortOrder: number;
  roundType: RoundType;
  title: string;
  config: RoundConfig;
}

export type SessionStatus = 'lobby' | 'live' | 'finished';

export interface Session {
  id: number;
  code: string;
  gameId: number;
  status: SessionStatus;
  createdAt: string;
}

/** Session plus the role secrets — only ever returned to the showrunner. */
export interface SessionWithKeys extends Session {
  showrunnerKey: string;
  hostKey: string;
}

export interface Team {
  id: number;
  sessionId: number;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface BuzzerMapping {
  id: number;
  sessionId: number;
  buzzerId: string;
  teamId: number;
}

export interface ScoreEvent {
  id: number;
  sessionId: number;
  teamId: number;
  delta: number;
  reason: string;
  roundIndex: number | null;
  questionId: number | null;
  createdAt: string;
}
