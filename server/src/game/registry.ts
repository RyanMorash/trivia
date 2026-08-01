import { GameEngine, type EngineDeps } from './engine.js';

/**
 * sessionCode -> GameEngine. Engines are created lazily (or at boot for
 * unfinished sessions) and rebuilt from the game_events journal, so a server
 * restart mid-game is invisible to clients beyond a reconnect.
 */
export class EngineRegistry {
  private engines = new Map<string, GameEngine>();

  constructor(private deps: EngineDeps) {}

  /** Recover every unfinished session at boot. */
  recoverAll(): void {
    for (const session of this.deps.sessions.listUnfinished()) {
      if (!this.engines.has(session.code)) {
        this.load(session.code);
      }
    }
  }

  get(code: string): GameEngine | null {
    const normalized = code.toUpperCase();
    return this.engines.get(normalized) ?? this.load(normalized);
  }

  private load(code: string): GameEngine | null {
    const session = this.deps.sessions.getByCode(code);
    if (!session) return null;
    const engine = new GameEngine(this.deps, session);
    engine.replayJournal();
    this.engines.set(session.code, engine);
    console.log(`[registry] loaded session ${session.code} (${session.status})`);
    return engine;
  }
}
