import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { BuzzResult } from '@trivia/shared';

/**
 * Dev buzzer simulator (and live fallback if hardware dies): big buttons per
 * buzzer ID, keys 1-8 for racing buzzes from a keyboard. Uses the exact HTTP
 * endpoint a microcontroller would.
 */
export default function BuzzerSim() {
  const [code, setCode] = useState(sessionStorage.getItem('sim-code') ?? '');
  const [idsText, setIdsText] = useState(sessionStorage.getItem('sim-ids') ?? 'B1,B2,B3,B4');
  const [log, setLog] = useState<string[]>([]);

  const ids = idsText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const buzz = useCallback(
    async (buzzerId: string) => {
      const c = code.trim().toUpperCase();
      if (!c) return;
      try {
        const res = await api.post<BuzzResult>(`/api/sessions/${c}/buzz`, { buzzerId, ts: Date.now() });
        setLog((l) =>
          [`${buzzerId}: ${res.accepted ? `accepted #${res.order}` : `rejected (${res.reason})`}`, ...l].slice(0, 12),
        );
      } catch (err) {
        setLog((l) => [`${buzzerId}: ${(err as Error).message}`, ...l].slice(0, 12));
      }
    },
    [code],
  );

  useEffect(() => {
    sessionStorage.setItem('sim-code', code);
    sessionStorage.setItem('sim-ids', idsText);
  }, [code, idsText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= ids.length) void buzz(ids[n - 1]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids, buzz]);

  return (
    <div className="page">
      <h1>Buzzer simulator</h1>
      <div className="panel row">
        <label>
          Session code{' '}
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 100 }} />
        </label>
        <label>
          Buzzer IDs <input value={idsText} onChange={(e) => setIdsText(e.target.value)} style={{ width: 240 }} />
        </label>
        <span className="muted small">Keyboard keys 1–{Math.min(ids.length, 8)} buzz too (for racing)</span>
      </div>
      <div className="sim-buttons">
        {ids.map((id) => (
          <button key={id} onClick={() => buzz(id)}>
            {id}
          </button>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h3>Log</h3>
        {log.length === 0 ? (
          <div className="muted">No buzzes yet</div>
        ) : (
          <div className="stack mono small">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
