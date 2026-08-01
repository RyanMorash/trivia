import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Game, QuestionSet, Session, SessionWithKeys } from '@trivia/shared';
import { api } from '../../lib/api';

type SessionRow = Session & { gameName: string };

export default function Console() {
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [newSetName, setNewSetName] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [sessionGameId, setSessionGameId] = useState('');
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = async () => {
    setSets(await api.get('/api/question-sets'));
    setGames(await api.get('/api/games'));
    setSessions(await api.get('/api/sessions'));
  };

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

  const guard = (fn: () => Promise<void>) => () =>
    fn()
      .then(() => setError(null))
      .catch((e) => setError((e as Error).message));

  return (
    <div className="page">
      <div className="spread">
        <h1>Showrunner console</h1>
        <Link to="/">← Landing</Link>
      </div>
      {error && <div className="toast error">{error}</div>}

      <div className="panel">
        <h2>Sessions</h2>
        <p className="muted small">A session is one live event: teams, buzzer mapping, scores.</p>
        <table className="grid">
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="mono">
                  <b>{s.code}</b>
                </td>
                <td>{s.gameName}</td>
                <td>
                  <span className={`tag${s.status === 'live' ? ' live' : ''}`}>{s.status}</span>
                </td>
                <td>
                  <OpenSession code={s.code} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <select value={sessionGameId} onChange={(e) => setSessionGameId(e.target.value)}>
            <option value="">Pick a game…</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!sessionGameId}
            onClick={guard(async () => {
              const s = await api.post<SessionWithKeys>('/api/sessions', { gameId: Number(sessionGameId) });
              // Keep the key out of the URL (browser history, logs); the
              // console reads it back from localStorage.
              localStorage.setItem(`sr-key-${s.code}`, s.showrunnerKey);
              navigate(`/console/session/${s.code}`);
            })}
          >
            Create session
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Games</h2>
        <p className="muted small">A game is an ordered list of rounds built from question sets.</p>
        <table className="grid">
          <tbody>
            {games.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>
                  <Link to={`/console/games/${g.id}`}>Edit rounds</Link>
                </td>
                <td>
                  <button
                    className="danger small"
                    onClick={guard(async () => {
                      if (!confirm(`Delete game "${g.name}"?`)) return;
                      await api.del(`/api/games/${g.id}`);
                      await refresh();
                    })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="New game name" value={newGameName} onChange={(e) => setNewGameName(e.target.value)} />
          <button
            className="primary"
            disabled={!newGameName.trim()}
            onClick={guard(async () => {
              const g = await api.post<Game>('/api/games', { name: newGameName.trim() });
              navigate(`/console/games/${g.id}`);
            })}
          >
            Create game
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Question sets</h2>
        <table className="grid">
          <tbody>
            {sets.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  <Link to={`/console/sets/${s.id}`}>Edit</Link>
                </td>
                <td>
                  <a href={`/api/question-sets/${s.id}/export`} target="_blank" rel="noreferrer">
                    Export JSON
                  </a>
                </td>
                <td>
                  <button
                    className="danger small"
                    onClick={guard(async () => {
                      if (!confirm(`Delete set "${s.name}" and all its questions?`)) return;
                      await api.del(`/api/question-sets/${s.id}`);
                      await refresh();
                    })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="New set name" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} />
          <button
            className="primary"
            disabled={!newSetName.trim()}
            onClick={guard(async () => {
              const s = await api.post<QuestionSet>('/api/question-sets', { name: newSetName.trim() });
              navigate(`/console/sets/${s.id}`);
            })}
          >
            Create set
          </button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Import a set from JSON</summary>
          <p className="muted small">
            Shape: <code>{'{ "name": "...", "categories": [{ "name": "...", "questions": [{ "prompt", "answer", "value", "notes" }] }] }'}</code>
          </p>
          <textarea
            rows={6}
            style={{ width: '100%' }}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{"name":"My Set","categories":[...]}'
          />
          <button
            style={{ marginTop: 8 }}
            disabled={!importText.trim()}
            onClick={guard(async () => {
              await api.post('/api/question-sets/import', JSON.parse(importText));
              setImportText('');
              await refresh();
            })}
          >
            Import
          </button>
        </details>
      </div>
    </div>
  );
}

function OpenSession({ code }: { code: string }) {
  // The key isn't in the session list; the console stores keys it created.
  const stored = localStorage.getItem(`sr-key-${code}`);
  if (!stored) return <span className="muted small">key not on this device</span>;
  return <Link to={`/console/session/${code}`}>Open</Link>;
}
