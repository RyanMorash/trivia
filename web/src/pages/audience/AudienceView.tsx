import { useParams } from 'react-router-dom';
import type { GameSnapshot, WagerRoundState } from '@trivia/shared';
import { BoardGrid, teamName } from '../../components/common';
import { useGameState } from '../../lib/useGameState';

/**
 * Big-screen broadcast view for the projector / stream. Answers stay hidden
 * until the host reveals them; buzzes flash the team name.
 */
export default function AudienceView() {
  const { code = '' } = useParams();
  const { snapshot, connected } = useGameState(code, 'audience');

  if (!snapshot) {
    return (
      <div className="stage">
        <div className="stage-main">
          <div className="title-card">
            <div className="kicker">Trivia Live</div>
            <h1>{connected ? `Joining ${code}…` : 'Connecting…'}</h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <div className="stage-main">
        <MainStage snapshot={snapshot} />
      </div>
      <div className="scorebar">
        {snapshot.teams.map((t) => {
          const answering = snapshot.buzz?.answeringTeamId === t.id;
          return (
            <div key={t.id} className={`score-chip${answering ? ' answering' : ''}`}>
              <div className="team-name">{t.name}</div>
              <div className={`team-score${t.score < 0 ? ' negative' : ''}`}>{t.score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MainStage({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round;

  if (snapshot.status === 'lobby') {
    return (
      <div className="title-card">
        <div className="kicker">Get ready</div>
        <h1>{snapshot.gameName}</h1>
        <p className="muted">The game is about to begin</p>
      </div>
    );
  }

  if (snapshot.status === 'finished') {
    const sorted = [...snapshot.teams].sort((a, b) => b.score - a.score);
    return (
      <div className="title-card">
        <div className="kicker">Final results</div>
        <h1>🏆 {sorted[0]?.name}</h1>
        <div className="stack" style={{ maxWidth: 480, margin: '0 auto' }}>
          {sorted.map((t, i) => (
            <div key={t.id} className="spread panel" style={{ margin: 0, padding: '10px 18px' }}>
              <span>
                {i + 1}. {t.name}
              </span>
              <b>{t.score}</b>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="title-card">
        <div className="kicker">{snapshot.gameName}</div>
        <h1>Round {snapshot.roundIndex + 2 > snapshot.rounds.length ? '' : 'coming up'}</h1>
      </div>
    );
  }

  const roundTitle = snapshot.rounds[snapshot.roundIndex]?.title ?? '';

  if (round.phase === 'round-intro') {
    return (
      <div className="title-card">
        <div className="kicker">Round {snapshot.roundIndex + 1}</div>
        <h1>{roundTitle}</h1>
        {round.type === 'wager' && <p className="muted">Topic: {round.topic}</p>}
      </div>
    );
  }

  if (round.type === 'board') {
    if (round.phase === 'idle' || round.phase === 'round-complete') {
      return (
        <div style={{ width: '100%', maxWidth: 1200 }}>
          <BoardGrid round={round} />
        </div>
      );
    }
    return (
      <ClueStage
        snapshot={snapshot}
        categoryName={round.currentClue?.categoryName ?? ''}
        value={round.currentClue?.value ?? null}
        prompt={round.currentClue?.prompt ?? ''}
        revealedAnswer={round.phase === 'answer-reveal' ? round.revealedAnswer : null}
        phase={round.phase}
      />
    );
  }

  if (round.type === 'quickfire') {
    if (round.phase === 'idle') {
      return (
        <div className="title-card">
          <div className="kicker">{roundTitle}</div>
          <h1>
            Question {Math.max(round.questionIndex + 2, 1)} of {round.totalQuestions}
          </h1>
        </div>
      );
    }
    if (round.phase === 'round-complete') {
      return (
        <div className="title-card">
          <div className="kicker">{roundTitle}</div>
          <h1>Round complete</h1>
        </div>
      );
    }
    return (
      <ClueStage
        snapshot={snapshot}
        categoryName={`${round.currentClue?.categoryName ?? ''} · ${round.questionIndex + 1}/${round.totalQuestions}`}
        value={round.currentClue?.value ?? null}
        prompt={round.currentClue?.prompt ?? ''}
        revealedAnswer={round.phase === 'answer-reveal' ? round.revealedAnswer : null}
        phase={round.phase}
      />
    );
  }

  return <WagerStage snapshot={snapshot} round={round} />;
}

function ClueStage({
  snapshot,
  categoryName,
  value,
  prompt,
  revealedAnswer,
  phase,
}: {
  snapshot: GameSnapshot;
  categoryName: string;
  value: number | null;
  prompt: string;
  revealedAnswer: string | null;
  phase: string;
}) {
  const buzz = snapshot.buzz;
  return (
    <>
      <div className="clue-full">
        <div className="clue-meta">
          {categoryName}
          {value ? ` — ${value}` : ''}
        </div>
        <div className="clue-text">{prompt}</div>
        {revealedAnswer && <div className="clue-answer">{revealedAnswer}</div>}
      </div>
      {phase === 'buzzing-open' && <div className="buzz-flash">BUZZERS OPEN</div>}
      {phase === 'judging' && buzz?.answeringTeamId != null && (
        <div className="buzz-flash">{teamName(snapshot, buzz.answeringTeamId)} 🔔</div>
      )}
    </>
  );
}

function WagerStage({ snapshot, round }: { snapshot: GameSnapshot; round: WagerRoundState }) {
  if (round.phase === 'wager-collect') {
    const waiting = round.teams.filter((t) => !t.wagerSubmitted).length;
    return (
      <div className="title-card">
        <div className="kicker">Place your wagers</div>
        <h1>{round.topic}</h1>
        <p className="muted">{waiting > 0 ? `Waiting for ${waiting} team${waiting > 1 ? 's' : ''}…` : 'All wagers in!'}</p>
      </div>
    );
  }

  if (round.phase === 'clue-shown' || round.phase === 'answer-collect') {
    return (
      <div className="clue-full">
        <div className="clue-meta">{round.topic}</div>
        <div className="clue-text">{round.clue?.prompt}</div>
        {round.phase === 'answer-collect' && (
          <div className="clue-meta" style={{ marginTop: '1em' }}>
            Teams are answering…
          </div>
        )}
      </div>
    );
  }

  if (round.phase === 'reveal') {
    const current = round.teams.find((t) => t.teamId === round.currentRevealTeamId);
    return (
      <div style={{ width: '100%', maxWidth: 900 }} className="stack">
        {current ? (
          <div className="clue-full">
            <div className="clue-meta">{teamName(snapshot, current.teamId)}</div>
            {current.revealStage !== 'hidden' && <div className="clue-text">“{current.answer}”</div>}
            {(current.revealStage === 'judged' || current.revealStage === 'wager-shown') && (
              <div className="clue-answer">{current.judged === 'correct' ? '✓ CORRECT' : '✗ WRONG'}</div>
            )}
            {current.revealStage === 'wager-shown' && (
              <div className="clue-answer">Wager: {current.wager}</div>
            )}
          </div>
        ) : (
          <div className="title-card">
            <div className="kicker">{round.topic}</div>
            <h1>The reveal</h1>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="title-card">
      <div className="kicker">{round.topic}</div>
      <h1>Round complete</h1>
    </div>
  );
}
