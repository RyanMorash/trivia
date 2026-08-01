import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  BuzzerSeenEvent,
  Command,
  CommandAck,
  GameSnapshot,
  Role,
  ToastEvent,
} from '@trivia/shared';

export interface Toast extends ToastEvent {
  id: number;
}

export interface GameConnection {
  snapshot: GameSnapshot | null;
  connected: boolean;
  authError: string | null;
  toasts: Toast[];
  lastBuzzerSeen: BuzzerSeenEvent | null;
  send: (cmd: Command) => Promise<CommandAck>;
}

let toastId = 0;

/**
 * The single sync primitive every mode renders from: connects with role
 * credentials, holds the latest role-filtered snapshot, and exposes send().
 * Reconnects re-authenticate and receive a fresh snapshot automatically.
 */
export function useGameState(
  code: string,
  role: Role,
  opts: { key?: string; teamId?: number } = {},
): GameConnection {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastBuzzerSeen, setLastBuzzerSeen] = useState<BuzzerSeenEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('/', {
      auth: { code, role, key: opts.key, teamId: opts.teamId },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setAuthError(null);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      setAuthError(err.message);
    });
    socket.on('state:snapshot', (snap: GameSnapshot) => {
      setSnapshot((prev) => (prev && prev.seq > snap.seq ? prev : snap));
    });
    socket.on('buzzer:seen', (ev: BuzzerSeenEvent) => setLastBuzzerSeen(ev));
    socket.on('toast', (ev: ToastEvent) => {
      const t: Toast = { ...ev, id: ++toastId };
      setToasts((prev) => [...prev.slice(-4), t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 6000);
    });

    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, [code, role, opts.key, opts.teamId]);

  const send = useCallback((cmd: Command): Promise<CommandAck> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      socket.timeout(5000).emit('cmd', cmd, (err: unknown, res: CommandAck) => {
        resolve(err ? { ok: false, error: 'Timed out' } : res);
      });
    });
  }, []);

  return { snapshot, connected, authError, toasts, lastBuzzerSeen, send };
}
