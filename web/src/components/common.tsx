import type { BoardRoundState, GameSnapshot } from '@trivia/shared';
import type { Toast } from '../lib/useGameState';

export function ConnBanner({ connected, authError }: { connected: boolean; authError: string | null }) {
  if (connected) return null;
  return <div className="conn-banner">{authError ? `Connection refused: ${authError}` : 'Reconnecting…'}</div>;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function Scoreboard({ snapshot }: { snapshot: GameSnapshot }) {
  const buzz = snapshot.buzz;
  return (
    <div className="scorebar">
      {snapshot.teams.map((t) => {
        const answering = buzz?.answeringTeamId === t.id;
        const locked = buzz ? buzz.lockedTeamIds.includes(t.id) : false;
        return (
          <div key={t.id} className={`score-chip${answering ? ' answering' : ''}${locked ? ' locked' : ''}`}>
            <span className={`conn-dot${t.connected ? ' on' : ''}`} title={t.connected ? 'Tablet connected' : 'No tablet connected'} />
            <div className="team-name">{t.name}</div>
            <div className={`team-score${t.score < 0 ? ' negative' : ''}`}>{t.score}</div>
          </div>
        );
      })}
    </div>
  );
}

export function BoardGrid({
  round,
  onPick,
}: {
  round: BoardRoundState;
  onPick?: (questionId: number) => void;
}) {
  const cols = round.board.length;
  const rows = Math.max(...round.board.map((c) => c.cells.length), 0);
  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {round.board.map((cat) => (
        <div key={cat.categoryId} className="cat-header">
          {cat.name}
        </div>
      ))}
      {Array.from({ length: rows }, (_, row) =>
        round.board.map((cat) => {
          const cell = cat.cells[row];
          if (!cell) return <div key={`${cat.categoryId}-${row}`} />;
          if (onPick) {
            return (
              <button
                key={cell.questionId}
                className={`cell${cell.used ? ' used' : ''}`}
                disabled={cell.used}
                onClick={() => onPick(cell.questionId)}
              >
                {cell.used ? '' : cell.value}
              </button>
            );
          }
          return (
            <div key={cell.questionId} className={`cell${cell.used ? ' used' : ''}`}>
              {cell.used ? '' : cell.value}
            </div>
          );
        }),
      )}
    </div>
  );
}

export function teamName(snapshot: GameSnapshot, teamId: number | null | undefined): string {
  if (teamId === null || teamId === undefined) return '—';
  return snapshot.teams.find((t) => t.id === teamId)?.name ?? `Team ${teamId}`;
}
