import { Router, type Request, type Response } from 'express';
import type { ContentRepo } from '../db/repos/contentRepo.js';
import { publicSession, type SessionRepo } from '../db/repos/sessionRepo.js';
import type { EngineRegistry } from '../game/registry.js';
import type { SessionWithKeys } from '@trivia/shared';

const int = (v: unknown, fallback = 0): number =>
  Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback;
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export function sessionsRouter(
  sessions: SessionRepo,
  content: ContentRepo,
  registry: EngineRegistry,
): Router {
  const r = Router();

  /** Mutating session endpoints require the showrunner key (?key=...). */
  function requireShowrunner(req: Request, res: Response): SessionWithKeys | null {
    const session = sessions.getByCode(str(req.params.code));
    if (!session) {
      res.status(404).json({ error: 'not found' });
      return null;
    }
    if (str(req.query.key) !== session.showrunnerKey) {
      res.status(403).json({ error: 'bad key' });
      return null;
    }
    return session;
  }

  r.post('/sessions', (req, res) => {
    const game = content.getGame(int(req.body?.gameId));
    if (!game) return res.status(400).json({ error: 'unknown gameId' });
    const session = sessions.create(game.id);
    res.status(201).json(session);
  });

  r.get('/sessions', (_req, res) => {
    res.json(
      sessions.list().map((s) => ({
        ...publicSession(s),
        gameName: content.getGame(s.gameId)?.name ?? '',
      })),
    );
  });

  // Public info for join screens — no keys.
  r.get('/sessions/:code', (req, res) => {
    const session = sessions.getByCode(str(req.params.code));
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json({
      ...publicSession(session),
      gameName: content.getGame(session.gameId)?.name ?? '',
      teams: sessions.listTeams(session.id).filter((t) => t.active),
    });
  });

  // Full info for the showrunner console (keys, mappings, all teams).
  r.get('/sessions/:code/full', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    res.json({
      ...session,
      gameName: content.getGame(session.gameId)?.name ?? '',
      teams: sessions.listTeams(session.id),
      buzzerMappings: sessions.listMappings(session.id),
    });
  });

  r.get('/sessions/:code/score-history', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    res.json(sessions.scoreHistory(session.id));
  });

  // ---- teams ----------------------------------------------------------------

  r.post('/sessions/:code/teams', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    const name = str(req.body?.name).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const count = sessions.listTeams(session.id).length;
    const team = sessions.createTeam(session.id, name, int(req.body?.sortOrder, count));
    registry.get(session.code)?.refreshRoster();
    res.status(201).json(team);
  });

  r.put('/sessions/:code/teams/:teamId', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    const team = sessions.getTeam(int(req.params.teamId));
    if (!team || team.sessionId !== session.id) return res.status(404).json({ error: 'not found' });
    sessions.updateTeam(
      team.id,
      str(req.body?.name, team.name),
      int(req.body?.sortOrder, team.sortOrder),
      typeof req.body?.active === 'boolean' ? req.body.active : team.active,
    );
    registry.get(session.code)?.refreshRoster();
    res.json(sessions.getTeam(team.id));
  });

  r.delete('/sessions/:code/teams/:teamId', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    const team = sessions.getTeam(int(req.params.teamId));
    if (!team || team.sessionId !== session.id) return res.status(404).json({ error: 'not found' });
    if (session.status !== 'lobby') {
      return res.status(400).json({ error: 'cannot delete teams after the game starts — deactivate instead' });
    }
    sessions.deleteTeam(team.id);
    registry.get(session.code)?.refreshRoster();
    res.json({ ok: true });
  });

  // ---- buzzer mappings ------------------------------------------------------

  r.put('/sessions/:code/buzzers', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    const buzzerId = str(req.body?.buzzerId).trim();
    const team = sessions.getTeam(int(req.body?.teamId));
    if (!buzzerId) return res.status(400).json({ error: 'buzzerId is required' });
    if (!team || team.sessionId !== session.id) return res.status(400).json({ error: 'unknown team' });
    const mapping = sessions.setMapping(session.id, buzzerId, team.id);
    registry.get(session.code)?.refreshRoster();
    res.json(mapping);
  });

  r.delete('/sessions/:code/buzzers/:buzzerId', (req, res) => {
    const session = requireShowrunner(req, res);
    if (!session) return;
    sessions.deleteMapping(session.id, str(req.params.buzzerId));
    registry.get(session.code)?.refreshRoster();
    res.json({ ok: true });
  });

  // ---- HTTP buzz ingest (microcontrollers + simulator) ----------------------

  r.post('/sessions/:code/buzz', (req, res) => {
    const engine = registry.get(str(req.params.code));
    if (!engine) return res.status(404).json({ accepted: false, reason: 'no-session' });
    const buzzerId = str(req.body?.buzzerId).trim();
    if (!buzzerId) return res.status(400).json({ accepted: false, reason: 'unmapped' });
    res.json(engine.ingestBuzz(buzzerId.slice(0, 64)));
  });

  return r;
}
