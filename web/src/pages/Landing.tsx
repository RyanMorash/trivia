import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Team } from '@trivia/shared';

interface SessionInfo {
  code: string;
  gameName: string;
  teams: Team[];
}

export default function Landing() {
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const lookup = async () => {
    setError(null);
    try {
      setInfo(await api.get<SessionInfo>(`/api/sessions/${code.trim().toUpperCase()}`));
    } catch (err) {
      setInfo(null);
      setError((err as Error).message);
    }
  };

  return (
    <div className="landing">
      <div className="card stack">
        <div>
          <div className="muted" style={{ letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            Trivia Live
          </div>
          <h1>Join a game</h1>
        </div>
        {!info ? (
          <>
            <input
              className="code"
              placeholder="CODE"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
            />
            {error && <div className="toast error">{error}</div>}
            <button className="primary" onClick={lookup} disabled={code.trim().length < 3}>
              Find game
            </button>
          </>
        ) : (
          <>
            <h2>{info.gameName}</h2>
            <button className="gold" onClick={() => navigate(`/audience/${info.code}`)}>
              Open audience display
            </button>
            <div className="muted small">Team tablet? Pick your team:</div>
            <div className="stack">
              {info.teams.map((t) => (
                <button key={t.id} onClick={() => navigate(`/team/${info.code}/${t.id}`)}>
                  {t.name}
                </button>
              ))}
              {info.teams.length === 0 && <div className="muted">No teams yet — the showrunner adds them.</div>}
            </div>
            <button onClick={() => setInfo(null)}>← Different code</button>
          </>
        )}
        <div className="muted small">
          Staff? <Link to="/console">Showrunner console</Link> · <Link to="/dev/buzzers">Buzzer simulator</Link>
        </div>
      </div>
    </div>
  );
}
