import type { Server, Socket } from 'socket.io';
import type {
  BuzzerConnectAuth,
  BuzzPayload,
  Command,
  CommandAck,
  ConnectAuth,
  Role,
} from '@trivia/shared';
import type { SessionRepo } from '../db/repos/sessionRepo.js';
import type { EngineEmitter } from '../game/engine.js';
import type { EngineRegistry } from '../game/registry.js';
import { CommandError } from '../game/rounds/RoundType.js';

const ROLES: Role[] = ['showrunner', 'host', 'competitor', 'audience'];

const roomAll = (code: string) => `s:${code}:all`;
const roomRole = (code: string, role: Role) => `s:${code}:${role}`;
const roomTeam = (code: string, teamId: number) => `s:${code}:team:${teamId}`;

/**
 * Build the emitter the engines broadcast through. Competitor snapshots are
 * per-team (own wagers/answers stay visible to their own tablet only), so
 * each team room gets its own projection.
 */
export function createEmitter(io: Server): EngineEmitter {
  return {
    broadcast(engine) {
      const code = engine.code;
      for (const role of ['showrunner', 'host', 'audience'] as const) {
        io.to(roomRole(code, role)).emit('state:snapshot', engine.snapshot(role));
      }
      for (const team of engine.snapshot('audience').teams) {
        io.to(roomTeam(code, team.id)).emit('state:snapshot', engine.snapshot('competitor', team.id));
      }
    },
    buzzAccepted(code, ev) {
      io.to(roomAll(code)).emit('buzz:accepted', ev);
    },
    buzzerSeen(code, ev) {
      io.to(roomRole(code, 'showrunner')).emit('buzzer:seen', ev);
    },
    toastShowrunner(code, ev) {
      io.to(roomRole(code, 'showrunner')).emit('toast', ev);
    },
  };
}

export function setupSockets(io: Server, registry: EngineRegistry, sessions: SessionRepo): void {
  io.use((socket, next) => {
    const auth = socket.handshake.auth as Partial<ConnectAuth>;
    if (!auth.code || !auth.role || !ROLES.includes(auth.role)) {
      return next(new Error('Missing or invalid code/role'));
    }
    const session = sessions.getByCode(auth.code);
    if (!session) return next(new Error('Unknown session code'));

    if (auth.role === 'showrunner' && auth.key !== session.showrunnerKey) {
      return next(new Error('Bad showrunner key'));
    }
    if (auth.role === 'host' && auth.key !== session.hostKey && auth.key !== session.showrunnerKey) {
      return next(new Error('Bad host key'));
    }
    if (auth.role === 'competitor') {
      const team = auth.teamId !== undefined ? sessions.getTeam(auth.teamId) : null;
      if (!team || team.sessionId !== session.id) return next(new Error('Unknown team'));
    }

    socket.data.code = session.code;
    socket.data.role = auth.role;
    socket.data.teamId = auth.role === 'competitor' ? auth.teamId : undefined;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const code = socket.data.code as string;
    const role = socket.data.role as Role;
    const teamId = socket.data.teamId as number | undefined;

    const engine = registry.get(code);
    if (!engine) {
      socket.disconnect(true);
      return;
    }

    socket.join([roomAll(code), roomRole(code, role)]);
    if (role === 'competitor' && teamId !== undefined) {
      socket.join(roomTeam(code, teamId));
      engine.teamConnected(teamId, 1);
    }

    socket.emit('state:snapshot', engine.snapshot(role, teamId));

    socket.on('cmd', (cmd: Command, ack?: (res: CommandAck) => void) => {
      try {
        if (!cmd || typeof cmd.type !== 'string') throw new CommandError('Malformed command');
        engine.dispatch(cmd, { role, teamId });
        ack?.({ ok: true });
      } catch (err) {
        if (err instanceof CommandError) {
          ack?.({ ok: false, error: err.message });
        } else {
          console.error('[cmd] unexpected error', err);
          ack?.({ ok: false, error: 'Internal error' });
        }
      }
    });

    socket.on('disconnect', () => {
      if (role === 'competitor' && teamId !== undefined) {
        engine.teamConnected(teamId, -1);
      }
    });
  });

  // ---- /buzzers namespace: hardware + simulator ingest ----------------------
  io.of('/buzzers').use((socket, next) => {
    const auth = socket.handshake.auth as Partial<BuzzerConnectAuth>;
    if (!auth.code) return next(new Error('Missing session code'));
    const session = sessions.getByCode(auth.code);
    if (!session) return next(new Error('Unknown session code'));
    socket.data.code = session.code;
    next();
  });

  io.of('/buzzers').on('connection', (socket) => {
    const code = socket.data.code as string;
    socket.on('buzz', (payload: Partial<BuzzPayload>, ack?: (res: unknown) => void) => {
      if (!payload || typeof payload.buzzerId !== 'string' || payload.buzzerId.length === 0) {
        ack?.({ accepted: false, reason: 'invalid' });
        return;
      }
      const engine = registry.get(code);
      if (!engine) {
        ack?.({ accepted: false, reason: 'no-session' });
        return;
      }
      ack?.(engine.ingestBuzz(payload.buzzerId.slice(0, 64)));
    });
  });
}
