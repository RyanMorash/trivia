import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { BuzzerMapping, SessionWithKeys, Team } from '@trivia/shared';
import RoundControls from '../../components/RoundControls';
import { ConnBanner, Scoreboard, Toasts } from '../../components/common';
import { api } from '../../lib/api';
import { useGameState } from '../../lib/useGameState';

type FullSession = SessionWithKeys & {
  gameName: string;
  teams: Team[];
  buzzerMappings: BuzzerMapping[];
};

export default function SessionControl() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  // Prefer a key stored on this device (session creation stores it) so the
  // showrunner secret doesn't have to travel in the URL; ?key= still works
  // for opening the console on another device.
  const key = params.get('key') ?? localStorage.getItem(`sr-key-${code}`) ?? '';
  const [tab, setTab] = useState<'setup' | 'live'>('setup');
  const [full, setFull] = useState<FullSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conn = useGameState(code, 'showrunner', { key });

  // Remember the key so the console list can reopen this session later.
  useEffect(() => {
    if (code && key) localStorage.setItem(`sr-key-${code}`, key);
  }, [code, key]);

  const refreshFull = useCallback(async () => {
    setFull(await api.get<FullSession>(`/api/sessions/${code}/full?key=${key}`));
  }, [code, key]);

  useEffect(() => {
    refreshFull().catch((e) => setError((e as Error).message));
  }, [refreshFull]);

  // Once live, jump to the live tab by default.
  const status = conn.snapshot?.status;
  useEffect(() => {
    if (status === 'live') setTab('live');
  }, [status]);

  if (!full) {
    return (
      <div className="page">
        {error ? <div className="toast error">{error}</div> : 'Loading…'}
      </div>
    );
  }

  return (
    <div className="page">
      <ConnBanner connected={conn.connected} authError={conn.authError} />
      <Toasts toasts={conn.toasts} />
      <div className="spread">
        <h1>
          {full.gameName} <span className="mono tag">{code}</span>
        </h1>
        <Link to="/console">← Console</Link>
      </div>
      {error && <div className="toast error">{error}</div>}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className={tab === 'setup' ? 'gold' : ''} onClick={() => setTab('setup')}>
          Setup
        </button>
        <button className={tab === 'live' ? 'gold' : ''} onClick={() => setTab('live')}>
          Live control
        </button>
      </div>

      {tab === 'setup' ? (
        <SetupTab code={code} srKey={key} full={full} refreshFull={refreshFull} conn={conn} onError={setError} />
      ) : (
        <LiveTab conn={conn} />
      )}
    </div>
  );
}

function SetupTab({
  code,
  srKey,
  full,
  refreshFull,
  conn,
  onError,
}: {
  code: string;
  srKey: string;
  full: FullSession;
  refreshFull: () => Promise<void>;
  conn: ReturnType<typeof useGameState>;
  onError: (msg: string | null) => void;
}) {
  const [newTeam, setNewTeam] = useState('');
  const [manualBuzzer, setManualBuzzer] = useState('');
  const base = window.location.origin;

  const guard = (fn: () => Promise<void>) => () =>
    fn()
      .then(() => onError(null))
      .catch((e) => onError((e as Error).message));

  const mapBuzzer = (buzzerId: string, teamId: number) =>
    guard(async () => {
      await api.put(`/api/sessions/${code}/buzzers?key=${srKey}`, { buzzerId, teamId });
      await refreshFull();
    })();

  const seen = conn.lastBuzzerSeen;

  return (
    <>
      <div className="panel">
        <h2>Teams</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Team</th>
              <th>Buzzers</th>
              <th>Tablet URL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {full.teams.map((t) => {
              const buzzers = full.buzzerMappings.filter((m) => m.teamId === t.id);
              const url = `${base}/team/${code}/${t.id}`;
              return (
                <tr key={t.id} style={t.active ? undefined : { opacity: 0.45 }}>
                  <td>
                    <b>{t.name}</b>
                    {!t.active && <span className="tag"> inactive</span>}
                  </td>
                  <td>
                    {buzzers.length === 0 ? (
                      <span className="muted small">none mapped</span>
                    ) : (
                      buzzers.map((m) => (
                        <span key={m.id} className="tag mono" style={{ marginRight: 6 }}>
                          {m.buzzerId}{' '}
                          <button
                            type="button"
                            className="small"
                            aria-label={`Unmap buzzer ${m.buzzerId}`}
                            style={{ padding: '0 0.4em' }}
                            onClick={guard(async () => {
                              await api.del(`/api/sessions/${code}/buzzers/${encodeURIComponent(m.buzzerId)}?key=${srKey}`);
                              await refreshFull();
                            })}
                          >
                            ✕
                          </button>
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <CopyLink url={url} />
                  </td>
                  <td>
                    <div className="row">
                      <button
                        onClick={guard(async () => {
                          await api.put(`/api/sessions/${code}/teams/${t.id}?key=${srKey}`, { active: !t.active });
                          await refreshFull();
                        })}
                      >
                        {t.active ? 'Deactivate' : 'Activate'}
                      </button>
                      {full.status === 'lobby' && (
                        <button
                          className="danger"
                          onClick={guard(async () => {
                            if (!confirm(`Remove team "${t.name}"?`)) return;
                            await api.del(`/api/sessions/${code}/teams/${t.id}?key=${srKey}`);
                            await refreshFull();
                          })}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            placeholder="New team name"
            value={newTeam}
            onChange={(e) => setNewTeam(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTeam.trim()) {
                guard(async () => {
                  await api.post(`/api/sessions/${code}/teams?key=${srKey}`, { name: newTeam.trim() });
                  setNewTeam('');
                  await refreshFull();
                })();
              }
            }}
          />
          <button
            className="primary"
            disabled={!newTeam.trim()}
            onClick={guard(async () => {
              await api.post(`/api/sessions/${code}/teams?key=${srKey}`, { name: newTeam.trim() });
              setNewTeam('');
              await refreshFull();
            })}
          >
            Add team
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Buzzer mapping</h2>
        <p className="muted small">
          Press a physical buzzer and it appears here — then tap the team it belongs to. (Hardware sends to{' '}
          <code className="mono">POST /api/sessions/{code}/buzz</code> or the <code className="mono">/buzzers</code>{' '}
          socket namespace — see docs/buzzer-protocol.md.)
        </p>
        {seen ? (
          <div className="panel" style={{ borderColor: 'var(--gold)' }}>
            <div className="row">
              <span>
                Last press: <b className="mono">{seen.buzzerId}</b>{' '}
                {seen.mappedTeamId !== null && (
                  <span className="muted small">
                    (currently → {full.teams.find((t) => t.id === seen.mappedTeamId)?.name ?? '?'})
                  </span>
                )}
              </span>
              {full.teams
                .filter((t) => t.active)
                .map((t) => (
                  <button key={t.id} className="primary" onClick={() => mapBuzzer(seen.buzzerId, t.id)}>
                    → {t.name}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div className="muted">Waiting for a buzzer press…</div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="Or type a buzzer ID" value={manualBuzzer} onChange={(e) => setManualBuzzer(e.target.value)} />
          {full.teams
            .filter((t) => t.active)
            .map((t) => (
              <button key={t.id} disabled={!manualBuzzer.trim()} onClick={() => mapBuzzer(manualBuzzer.trim(), t.id)}>
                → {t.name}
              </button>
            ))}
        </div>
      </div>

      <div className="panel">
        <h2>Screens & links</h2>
        <table className="grid">
          <tbody>
            <tr>
              <td>Host tablet</td>
              <td>
                <CopyLink url={`${base}/host/${code}?key=${full.hostKey}`} />
              </td>
            </tr>
            <tr>
              <td>Audience / stream display</td>
              <td>
                <CopyLink url={`${base}/audience/${code}`} />
              </td>
            </tr>
            <tr>
              <td>This console</td>
              <td>
                <CopyLink url={`${base}/console/session/${code}?key=${full.showrunnerKey}`} />
              </td>
            </tr>
            <tr>
              <td>Buzzer simulator (fallback)</td>
              <td>
                <CopyLink url={`${base}/dev/buzzers`} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function LiveTab({ conn }: { conn: ReturnType<typeof useGameState> }) {
  const snapshot = conn.snapshot;
  const [adjust, setAdjust] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [cmdError, setCmdError] = useState<string | null>(null);

  if (!snapshot) return <div className="panel">Waiting for game state…</div>;

  const run = async (cmd: Parameters<typeof conn.send>[0]) => {
    const res = await conn.send(cmd);
    setCmdError(res.ok ? null : (res.error ?? 'Command failed'));
  };

  const liveRound = snapshot.roundIndex;

  return (
    <>
      {cmdError && <div className="toast error">{cmdError}</div>}
      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Game flow</h2>
          <span className={`tag${snapshot.status === 'live' ? ' live' : ''}`}>{snapshot.status}</span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {snapshot.status === 'lobby' && (
            <button className="gold" onClick={() => run({ type: 'startGame' })}>
              ▶ Start game
            </button>
          )}
          {snapshot.status === 'live' &&
            snapshot.rounds.map((r, i) => (
              <button
                key={i}
                className={i === liveRound ? 'gold' : i === liveRound + 1 ? 'primary' : ''}
                onClick={() => run({ type: 'startRound', roundIndex: i })}
              >
                {i === liveRound ? '● ' : ''}R{i + 1}: {r.title}
              </button>
            ))}
          {snapshot.status === 'live' && (
            <button
              className="danger"
              onClick={() => {
                if (confirm('End the game and show final results?')) void run({ type: 'endGame' });
              }}
            >
              ■ End game
            </button>
          )}
        </div>
        {snapshot.status === 'live' && (
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => run({ type: 'clearLockouts' })}>Clear lockouts</button>
            <span className="muted small">Restarting a round rebuilds it from scratch (scores keep).</span>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Teams & scores</h2>
        <Scoreboard snapshot={snapshot} />
        <table className="grid" style={{ marginTop: 10 }}>
          <tbody>
            {snapshot.teams.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td style={{ width: 320 }}>
                  <div className="row">
                    <input
                      type="number"
                      style={{ width: 90 }}
                      placeholder="±points"
                      value={adjust[t.id] ?? ''}
                      onChange={(e) => setAdjust({ ...adjust, [t.id]: e.target.value })}
                    />
                    <button
                      disabled={!adjust[t.id]}
                      onClick={() =>
                        run({
                          type: 'adjustScore',
                          teamId: t.id,
                          delta: Number(adjust[t.id]),
                          reason: reason || 'manual',
                        }).then(() => setAdjust({ ...adjust, [t.id]: '' }))
                      }
                    >
                      Apply
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <input
          style={{ marginTop: 8, width: '100%' }}
          placeholder="Reason for adjustments (kept in the score ledger)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {snapshot.status === 'live' && snapshot.round && (
        <div className="panel">
          <h2>
            Round controls — R{liveRound + 1}: {snapshot.rounds[liveRound]?.title}
          </h2>
          <RoundControls snapshot={snapshot} send={conn.send} />
        </div>
      )}
    </>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="row">
      <code className="mono small" style={{ wordBreak: 'break-all' }}>
        {url}
      </code>
      <button
        className="small"
        onClick={() => {
          navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? '✓' : 'Copy'}
      </button>
    </span>
  );
}
