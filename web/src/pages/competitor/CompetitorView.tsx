import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { GameSnapshot, WagerRoundState } from '@trivia/shared';
import { ConnBanner, Scoreboard, teamName } from '../../components/common';
import { useGameState } from '../../lib/useGameState';

/**
 * Team tablet view: scores and the current clue only — physical buzzers do
 * the buzzing. Typed input appears just for wager rounds.
 */
export default function CompetitorView() {
  const { code = '', teamId = '' } = useParams();
  const tid = Number(teamId);
  const { snapshot, connected, authError, send } = useGameState(code, 'competitor', { teamId: tid });

  if (!snapshot) {
    return (
      <div className="console-touch">
        <ConnBanner connected={connected} authError={authError} />
        <div className="phase-banner">Connecting to {code}…</div>
      </div>
    );
  }

  const me = snapshot.teams.find((t) => t.id === tid);
  const buzz = snapshot.buzz;
  const round = snapshot.round;
  const amAnswering = buzz?.answeringTeamId === tid;
  const amLocked = buzz?.lockedTeamIds.includes(tid) ?? false;

  return (
    <div className="console-touch">
      <ConnBanner connected={connected} authError={authError} />
      <div className="my-score">
        <div className="name">{me?.name ?? `Team ${tid}`}</div>
        <div className={`points${(me?.score ?? 0) < 0 ? ' negative' : ''}`}>{me?.score ?? 0}</div>
      </div>

      {snapshot.status === 'lobby' && <div className="status-line">Get ready — the game starts soon!</div>}
      {snapshot.status === 'finished' && <FinalStanding snapshot={snapshot} tid={tid} />}

      {snapshot.status === 'live' && round && round.type !== 'wager' && (
        <>
          {'currentClue' in round && round.currentClue && (
            <div className="answer-card">
              <div className="label">
                {round.currentClue.categoryName} — {round.currentClue.value}
              </div>
              <div style={{ fontSize: '1.4rem' }}>{round.currentClue.prompt}</div>
            </div>
          )}
          {round.phase === 'buzzing-open' &&
            (amLocked ? (
              <div className="status-line locked">You're locked out of this clue</div>
            ) : (
              <div className="status-line hot">BUZZ NOW!</div>
            ))}
          {round.phase === 'judging' && buzz && (
            <div className={`status-line${amAnswering ? ' hot' : ''}`}>
              {amAnswering ? 'You buzzed first — answer!' : `${teamName(snapshot, buzz.answeringTeamId)} is answering…`}
            </div>
          )}
          {'revealedAnswer' in round && round.phase === 'answer-reveal' && round.revealedAnswer && (
            <div className="status-line">Answer: {round.revealedAnswer}</div>
          )}
        </>
      )}

      {snapshot.status === 'live' && round?.type === 'wager' && (
        <WagerPanel round={round} tid={tid} send={send} />
      )}

      <div style={{ marginTop: 'auto' }}>
        <Scoreboard snapshot={snapshot} />
      </div>
    </div>
  );
}

function FinalStanding({ snapshot, tid }: { snapshot: GameSnapshot; tid: number }) {
  const sorted = [...snapshot.teams].sort((a, b) => b.score - a.score);
  const place = sorted.findIndex((t) => t.id === tid) + 1;
  const medal = place === 1 ? '🏆' : place === 2 ? '🥈' : place === 3 ? '🥉' : '';
  return (
    <div className="status-line">
      Final result: {medal} {place === 1 ? 'Champions!' : `Place ${place} of ${sorted.length}`}
    </div>
  );
}

function WagerPanel({
  round,
  tid,
  send,
}: {
  round: WagerRoundState;
  tid: number;
  send: ReturnType<typeof useGameState>['send'];
}) {
  const mine = round.teams.find((t) => t.teamId === tid);
  const [wager, setWager] = useState('');
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setFeedback(null);
  }, [round.phase]);

  if (!mine) return <div className="status-line">Your team is not in this round.</div>;

  const wagerNum = Number(wager);
  const wagerValid =
    wager.trim() !== '' && Number.isInteger(wagerNum) && wagerNum >= 0 && wagerNum <= mine.maxWager;

  return (
    <div className="stack">
      {round.phase === 'wager-collect' && (
        <>
          <div className="status-line hot">Topic: {round.topic}</div>
          <div className="panel stack">
            <div className="muted">
              How much do you wager? (0 – {mine.maxWager})
            </div>
            <input
              type="number"
              min={0}
              max={mine.maxWager}
              value={wager}
              onChange={(e) => setWager(e.target.value)}
              style={{ fontSize: '1.8rem', textAlign: 'center' }}
            />
            <button
              className="gold btn-huge"
              disabled={!wagerValid}
              onClick={async () => {
                const res = await send({ type: 'submitWager', amount: wagerNum });
                setFeedback(res.ok ? 'Wager locked in ✓' : res.error ?? 'Failed');
              }}
            >
              Submit wager
            </button>
            {mine.wagerSubmitted && <div className="status-line">Current wager: {mine.wager}</div>}
            {feedback && <div className="muted">{feedback}</div>}
          </div>
        </>
      )}

      {round.phase === 'clue-shown' && round.clue && (
        <div className="answer-card">
          <div className="label">{round.topic}</div>
          <div style={{ fontSize: '1.4rem' }}>{round.clue.prompt}</div>
        </div>
      )}

      {round.phase === 'answer-collect' && (
        <>
          {round.clue && (
            <div className="answer-card">
              <div className="label">{round.topic}</div>
              <div style={{ fontSize: '1.2rem' }}>{round.clue.prompt}</div>
            </div>
          )}
          <div className="panel stack">
            <div className="muted">Type your answer:</div>
            <textarea
              rows={2}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              style={{ fontSize: '1.3rem' }}
            />
            <button
              className="gold btn-huge"
              disabled={answer.trim() === ''}
              onClick={async () => {
                const res = await send({ type: 'submitAnswer', text: answer });
                setFeedback(res.ok ? 'Answer submitted ✓' : res.error ?? 'Failed');
              }}
            >
              Submit answer
            </button>
            {mine.answerSubmitted && <div className="muted">Submitted: “{mine.answer}”</div>}
            {feedback && <div className="muted">{feedback}</div>}
          </div>
        </>
      )}

      {round.phase === 'reveal' && (
        <div className="status-line">
          {mine.revealStage === 'wager-shown'
            ? `Your result: ${mine.judged === 'correct' ? '✓ correct' : '✗ wrong'} (wagered ${mine.wager})`
            : 'The host is revealing answers…'}
        </div>
      )}
    </div>
  );
}
