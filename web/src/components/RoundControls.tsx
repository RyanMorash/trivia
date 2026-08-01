import { useState } from 'react';
import type {
  BoardRoundState,
  Command,
  CommandAck,
  GameSnapshot,
  QuickfireRoundState,
  WagerRoundState,
} from '@trivia/shared';
import { BoardGrid, teamName } from './common';

interface Props {
  snapshot: GameSnapshot;
  send: (cmd: Command) => Promise<CommandAck>;
}

/**
 * Shared judging controls rendered on both the host tablet and inside the
 * showrunner console — same commands, same state machine.
 */
export default function RoundControls({ snapshot, send }: Props) {
  const [error, setError] = useState<string | null>(null);
  const round = snapshot.round;

  const run = async (cmd: Command) => {
    const res = await send(cmd);
    setError(res.ok ? null : (res.error ?? 'Command failed'));
  };

  if (!round) return null;

  return (
    <div className="stack">
      {error && (
        <div className="toast error" role="alert">
          {error}
        </div>
      )}
      {round.type === 'board' && <BoardControls round={round} snapshot={snapshot} run={run} />}
      {round.type === 'quickfire' && <QuickfireControls round={round} snapshot={snapshot} run={run} />}
      {round.type === 'wager' && <WagerControls round={round} snapshot={snapshot} run={run} />}
    </div>
  );
}

type Run = (cmd: Command) => Promise<void>;

function BuzzJudgePanel({
  snapshot,
  run,
  clue,
  revealedAnswer,
  phase,
  extraIdle,
}: {
  snapshot: GameSnapshot;
  run: Run;
  clue: BoardRoundState['currentClue'];
  revealedAnswer: string | null;
  phase: string;
  extraIdle?: React.ReactNode;
}) {
  const buzz = snapshot.buzz;
  return (
    <>
      {clue && (
        <div className="answer-card">
          <div className="label">
            {clue.categoryName} — {clue.value}
          </div>
          <div style={{ fontSize: '1.25rem', margin: '0.4em 0' }}>{clue.prompt}</div>
          {clue.answer !== null && (
            <div className="value" style={{ color: 'var(--gold-soft)' }}>
              ✓ {clue.answer}
            </div>
          )}
          {clue.notes && <div className="muted small">Note: {clue.notes}</div>}
        </div>
      )}

      {phase === 'clue-shown' && (
        <div className="touch-actions">
          <button className="btn-huge gold" onClick={() => run({ type: 'openBuzzers' })}>
            Open buzzers
          </button>
          <button className="btn-huge" onClick={() => run({ type: 'markDead' })}>
            Dead clue
          </button>
        </div>
      )}

      {phase === 'buzzing-open' && (
        <>
          <div className="phase-banner hot">● Buzzers open — waiting for a buzz</div>
          <div className="touch-actions">
            <button className="btn-huge" onClick={() => run({ type: 'closeBuzzers' })}>
              Close buzzers
            </button>
            <button className="btn-huge" onClick={() => run({ type: 'markDead' })}>
              Dead clue
            </button>
          </div>
        </>
      )}

      {phase === 'judging' && buzz && (
        <>
          <div className="buzz-order">
            {buzz.queue.map((e) => (
              <div key={e.teamId} className={`entry${e.order === 1 ? ' first' : ''}`}>
                <span className="order-num">{e.order}</span>
                <span>{teamName(snapshot, e.teamId)}</span>
                {e.order === 1 && <span className="muted small">is answering</span>}
              </div>
            ))}
          </div>
          <div className="touch-actions">
            <button className="btn-huge correct" onClick={() => run({ type: 'judge', correct: true })}>
              ✓ Correct
            </button>
            <button className="btn-huge incorrect" onClick={() => run({ type: 'judge', correct: false })}>
              ✗ Wrong
            </button>
            <button className="btn-huge" onClick={() => run({ type: 'markDead' })}>
              Dead clue
            </button>
          </div>
        </>
      )}

      {phase === 'answer-reveal' && (
        <>
          <div className="answer-card">
            <div className="label">Answer</div>
            <div className="value">{revealedAnswer}</div>
          </div>
          <div className="touch-actions">
            <button className="btn-huge primary" onClick={() => run({ type: 'continue' })}>
              Continue →
            </button>
          </div>
        </>
      )}

      {phase === 'idle' && extraIdle}
    </>
  );
}

function BoardControls({
  round,
  snapshot,
  run,
}: {
  round: BoardRoundState;
  snapshot: GameSnapshot;
  run: Run;
}) {
  return (
    <>
      {round.phase === 'round-intro' && (
        <div className="touch-actions">
          <button className="btn-huge primary" onClick={() => run({ type: 'continue' })}>
            Show the board
          </button>
        </div>
      )}
      {round.phase === 'idle' && (
        <>
          <div className="phase-banner">Pick a clue</div>
          <BoardGrid round={round} onPick={(questionId) => run({ type: 'selectClue', questionId })} />
        </>
      )}
      {round.phase === 'round-complete' && <div className="phase-banner">Board cleared — round complete</div>}
      <BuzzJudgePanel
        snapshot={snapshot}
        run={run}
        clue={round.currentClue}
        revealedAnswer={round.revealedAnswer}
        phase={round.phase}
      />
    </>
  );
}

function QuickfireControls({
  round,
  snapshot,
  run,
}: {
  round: QuickfireRoundState;
  snapshot: GameSnapshot;
  run: Run;
}) {
  return (
    <>
      <div className="spread">
        <span className="tag">
          Question {Math.max(round.questionIndex + 1, 0)} / {round.totalQuestions}
        </span>
        <span className="tag">
          +{round.pointsPerQuestion}
          {round.wrongAnswerPenalty > 0 ? ` / −${round.wrongAnswerPenalty}` : ''}
        </span>
      </div>
      {(round.phase === 'round-intro' || round.phase === 'idle') && (
        <div className="touch-actions">
          <button className="btn-huge primary" onClick={() => run({ type: 'nextQuestion' })}>
            {round.questionIndex < 0 ? 'First question' : 'Next question'}
          </button>
        </div>
      )}
      {round.phase === 'round-complete' && <div className="phase-banner">Round complete</div>}
      <BuzzJudgePanel
        snapshot={snapshot}
        run={run}
        clue={round.currentClue}
        revealedAnswer={round.revealedAnswer}
        phase={round.phase}
      />
    </>
  );
}

function WagerControls({
  round,
  snapshot,
  run,
}: {
  round: WagerRoundState;
  snapshot: GameSnapshot;
  run: Run;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const current = round.teams.find((t) => t.teamId === round.currentRevealTeamId) ?? null;
  const allRevealed = round.teams.every((t) => t.revealStage === 'wager-shown');
  const revealOrder = [...round.teams].sort(
    (a, b) =>
      (snapshot.teams.find((t) => t.id === a.teamId)?.score ?? 0) -
      (snapshot.teams.find((t) => t.id === b.teamId)?.score ?? 0),
  );

  return (
    <>
      {round.phase === 'round-intro' && (
        <>
          <div className="phase-banner">Final round — topic: {round.topic}</div>
          <div className="touch-actions">
            <button className="btn-huge primary" onClick={() => run({ type: 'continue' })}>
              Open wagers
            </button>
          </div>
        </>
      )}

      {round.phase === 'wager-collect' && (
        <>
          <div className="phase-banner hot">Teams are wagering — topic: {round.topic}</div>
          <table className="grid">
            <thead>
              <tr>
                <th>Team</th>
                <th>Max</th>
                <th>Wager</th>
                <th>Set manually</th>
              </tr>
            </thead>
            <tbody>
              {round.teams.map((t) => (
                <tr key={t.teamId}>
                  <td>{teamName(snapshot, t.teamId)}</td>
                  <td className="mono">{t.maxWager}</td>
                  <td>{t.wagerSubmitted ? <b>{t.wager}</b> : <span className="muted">waiting…</span>}</td>
                  <td>
                    <span className="row">
                      <input
                        style={{ width: 90 }}
                        type="number"
                        min={0}
                        max={t.maxWager}
                        value={drafts[t.teamId] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [t.teamId]: e.target.value })}
                      />
                      <button
                        onClick={() =>
                          run({ type: 'setWager', teamId: t.teamId, amount: Number(drafts[t.teamId] ?? 0) })
                        }
                      >
                        Set
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="touch-actions">
            <button className="btn-huge gold" onClick={() => run({ type: 'lockWagers' })}>
              Lock wagers & show clue
            </button>
          </div>
        </>
      )}

      {(round.phase === 'clue-shown' || round.phase === 'answer-collect') && (
        <>
          {round.clue && (
            <div className="answer-card">
              <div className="label">{round.topic}</div>
              <div style={{ fontSize: '1.25rem', margin: '0.4em 0' }}>{round.clue.prompt}</div>
              {round.clue.answer !== null && (
                <div className="value" style={{ color: 'var(--gold-soft)' }}>
                  ✓ {round.clue.answer}
                </div>
              )}
            </div>
          )}
          {round.phase === 'clue-shown' ? (
            <div className="touch-actions">
              <button className="btn-huge primary" onClick={() => run({ type: 'continue' })}>
                Open answers
              </button>
            </div>
          ) : (
            <>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Answer</th>
                    <th>Type for them</th>
                  </tr>
                </thead>
                <tbody>
                  {round.teams.map((t) => (
                    <tr key={t.teamId}>
                      <td>{teamName(snapshot, t.teamId)}</td>
                      <td>{t.answerSubmitted ? <b>{t.answer}</b> : <span className="muted">typing…</span>}</td>
                      <td>
                        <span className="row">
                          <input
                            value={drafts[t.teamId] ?? ''}
                            onChange={(e) => setDrafts({ ...drafts, [t.teamId]: e.target.value })}
                          />
                          <button
                            onClick={() => run({ type: 'setAnswer', teamId: t.teamId, text: drafts[t.teamId] ?? '' })}
                          >
                            Set
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="touch-actions">
                <button className="btn-huge gold" onClick={() => run({ type: 'lockAnswers' })}>
                  Lock answers — start reveal
                </button>
              </div>
            </>
          )}
        </>
      )}

      {round.phase === 'reveal' && (
        <>
          {round.clue && (
            <div className="answer-card">
              <div className="label">Correct answer</div>
              <div className="value">{round.clue.answer ?? '—'}</div>
            </div>
          )}
          <div className="stack">
            {revealOrder.map((t) => {
              const isCurrent = current?.teamId === t.teamId;
              return (
                <div key={t.teamId} className="panel" style={isCurrent ? { borderColor: 'var(--gold)' } : undefined}>
                  <div className="spread">
                    <b>{teamName(snapshot, t.teamId)}</b>
                    <span className="tag">{t.revealStage}</span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    {t.revealStage === 'hidden' && (
                      <button className="primary" onClick={() => run({ type: 'revealTeam', teamId: t.teamId })}>
                        Reveal answer
                      </button>
                    )}
                    {t.revealStage === 'answer-shown' && (
                      <>
                        <span>“{t.answer}”</span>
                        <button className="primary" onClick={() => run({ type: 'judgeWager', teamId: t.teamId, correct: true })}>
                          ✓ Correct
                        </button>
                        <button className="danger" onClick={() => run({ type: 'judgeWager', teamId: t.teamId, correct: false })}>
                          ✗ Wrong
                        </button>
                      </>
                    )}
                    {t.revealStage === 'judged' && (
                      <>
                        <span>
                          “{t.answer}” — {t.judged === 'correct' ? '✓ correct' : '✗ wrong'}
                        </span>
                        <button
                          className="gold"
                          onClick={async () => {
                            if (!isCurrent) await run({ type: 'revealTeam', teamId: t.teamId });
                            await run({ type: 'revealStep' });
                          }}
                        >
                          Reveal wager
                        </button>
                      </>
                    )}
                    {t.revealStage === 'wager-shown' && (
                      <span>
                        “{t.answer}” — {t.judged === 'correct' ? '✓' : '✗'} wagered <b>{t.wager}</b>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {allRevealed && (
            <div className="touch-actions">
              <button className="btn-huge primary" onClick={() => run({ type: 'continue' })}>
                Finish round
              </button>
            </div>
          )}
        </>
      )}

      {round.phase === 'round-complete' && <div className="phase-banner">Final round complete</div>}
    </>
  );
}
