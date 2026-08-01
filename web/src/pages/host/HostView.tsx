import { useParams, useSearchParams } from 'react-router-dom';
import RoundControls from '../../components/RoundControls';
import { ConnBanner, Scoreboard } from '../../components/common';
import { useGameState } from '../../lib/useGameState';

/**
 * On-stage MC view, tablet-first: sees the answer, judges buzzes with three
 * giant buttons. Round/game advancement beyond judging lives with the
 * showrunner.
 */
export default function HostView() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const key = params.get('key') ?? '';
  const { snapshot, connected, authError, send } = useGameState(code, 'host', { key });

  if (!snapshot) {
    return (
      <div className="console-touch">
        <ConnBanner connected={connected} authError={authError} />
        <div className="phase-banner">Connecting to {code}…</div>
      </div>
    );
  }

  return (
    <div className="console-touch">
      <ConnBanner connected={connected} authError={authError} />
      <div className="spread">
        <h2 style={{ margin: 0 }}>{snapshot.gameName}</h2>
        <span className="tag">
          {snapshot.status === 'live' && snapshot.roundIndex >= 0
            ? `Round ${snapshot.roundIndex + 1}: ${snapshot.rounds[snapshot.roundIndex]?.title ?? ''}`
            : snapshot.status}
        </span>
      </div>
      <Scoreboard snapshot={snapshot} />
      {snapshot.status === 'lobby' && (
        <div className="phase-banner">Waiting for the showrunner to start the game</div>
      )}
      {snapshot.status === 'finished' && <div className="phase-banner">Game over — thanks for hosting!</div>}
      {snapshot.status === 'live' && !snapshot.round && (
        <div className="phase-banner">Waiting for the showrunner to start the round</div>
      )}
      <RoundControls snapshot={snapshot} send={send} />
    </div>
  );
}
