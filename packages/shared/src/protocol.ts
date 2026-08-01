import type { GameSnapshot, Role } from './state.js';

// Socket.IO protocol: the single contract between server and every client.
// App clients connect to the default namespace with ConnectAuth; hardware
// (microcontrollers / the simulator relay) connects to the /buzzers namespace.

export interface ConnectAuth {
  code: string;
  role: Role;
  /** Required for showrunner and host. */
  key?: string;
  /** Required for competitor. */
  teamId?: number;
}

export interface BuzzerConnectAuth {
  code: string;
}

// ---- client -> server -------------------------------------------------------

export type Command =
  // game flow (showrunner; host gets a judging subset — see ROLE_COMMANDS)
  | { type: 'startGame' }
  | { type: 'startRound'; roundIndex: number }
  | { type: 'nextRound' }
  | { type: 'endGame' }
  // judging rounds (board + quickfire)
  | { type: 'selectClue'; questionId: number }
  | { type: 'nextQuestion' }
  | { type: 'openBuzzers' }
  | { type: 'closeBuzzers' }
  | { type: 'judge'; correct: boolean }
  | { type: 'markDead' }
  | { type: 'continue' }
  // wager round
  | { type: 'submitWager'; amount: number }
  | { type: 'submitAnswer'; text: string }
  | { type: 'setWager'; teamId: number; amount: number }
  | { type: 'setAnswer'; teamId: number; text: string }
  | { type: 'lockWagers' }
  | { type: 'showWagerClue' }
  | { type: 'lockAnswers' }
  | { type: 'revealTeam'; teamId: number }
  | { type: 'revealStep' }
  | { type: 'judgeWager'; teamId: number; correct: boolean }
  // showrunner overrides
  | { type: 'adjustScore'; teamId: number; delta: number; reason: string }
  | { type: 'clearLockouts' };

export type CommandType = Command['type'];

export interface CommandAck {
  ok: boolean;
  error?: string;
}

/** Which roles may issue which commands. The server enforces this. */
export const ROLE_COMMANDS: Record<Role, readonly CommandType[] | 'all'> = {
  showrunner: 'all',
  host: [
    'selectClue',
    'nextQuestion',
    'openBuzzers',
    'closeBuzzers',
    'judge',
    'markDead',
    'continue',
    'lockWagers',
    'showWagerClue',
    'lockAnswers',
    'revealTeam',
    'revealStep',
    'judgeWager',
  ],
  competitor: ['submitWager', 'submitAnswer'],
  audience: [],
};

// ---- server -> client -------------------------------------------------------

export interface BuzzAcceptedEvent {
  teamId: number;
  order: number;
}

export interface ToastEvent {
  level: 'info' | 'warn' | 'error';
  msg: string;
}

/** Emitted to showrunners whenever any physical buzzer fires, mapped or not — powers the "press a buzzer to capture its ID" setup flow. */
export interface BuzzerSeenEvent {
  buzzerId: string;
  mappedTeamId: number | null;
}

export interface ServerToClientEvents {
  'state:snapshot': (snapshot: GameSnapshot) => void;
  'buzz:accepted': (ev: BuzzAcceptedEvent) => void;
  'buzzer:seen': (ev: BuzzerSeenEvent) => void;
  toast: (ev: ToastEvent) => void;
}

export interface ClientToServerEvents {
  cmd: (command: Command, ack: (res: CommandAck) => void) => void;
}

// ---- /buzzers namespace (hardware ingest) -----------------------------------

export interface BuzzPayload {
  buzzerId: string;
  /** Device timestamp, recorded for diagnostics only — never used for ordering. */
  ts?: number;
}

export type BuzzRejectReason =
  | 'not-open'
  | 'locked-out'
  | 'duplicate'
  | 'unmapped'
  | 'no-session';

export interface BuzzResult {
  accepted: boolean;
  order?: number;
  reason?: BuzzRejectReason;
}

export interface BuzzerClientToServerEvents {
  buzz: (payload: BuzzPayload, ack: (res: BuzzResult) => void) => void;
}
