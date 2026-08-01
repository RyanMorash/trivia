import type { DB } from '../connection.js';

export interface JournaledEvent {
  seq: number;
  type: string;
  payload: unknown;
}

/** Append-only journal of engine transitions, used to rebuild live state after a restart. */
export class EventRepo {
  constructor(private db: DB) {}

  append(sessionId: number, seq: number, type: string, payload: unknown): void {
    this.db
      .prepare('INSERT INTO game_events (session_id, seq, type, payload_json) VALUES (?, ?, ?, ?)')
      .run(sessionId, seq, type, JSON.stringify(payload ?? null));
  }

  listForSession(sessionId: number): JournaledEvent[] {
    const rows = this.db
      .prepare('SELECT seq, type, payload_json FROM game_events WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as { seq: number; type: string; payload_json: string }[];
    return rows.map((r) => ({ seq: r.seq, type: r.type, payload: JSON.parse(r.payload_json) }));
  }

  lastSeq(sessionId: number): number {
    const r = this.db
      .prepare('SELECT MAX(seq) AS m FROM game_events WHERE session_id = ?')
      .get(sessionId) as { m: number | null };
    return r.m ?? 0;
  }
}
