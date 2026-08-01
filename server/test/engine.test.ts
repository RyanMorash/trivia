import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardRoundState, QuickfireRoundState, WagerRoundState } from '@trivia/shared';
import { openDb, type DB } from '../src/db/connection.js';
import { ContentRepo } from '../src/db/repos/contentRepo.js';
import { EventRepo } from '../src/db/repos/eventRepo.js';
import { SessionRepo } from '../src/db/repos/sessionRepo.js';
import { GameEngine, type EngineEmitter } from '../src/game/engine.js';
import { CommandError } from '../src/game/rounds/RoundType.js';

const stubEmitter = (): EngineEmitter & { toasts: string[] } => {
  const toasts: string[] = [];
  return {
    toasts,
    broadcast() {},
    buzzAccepted() {},
    buzzerSeen() {},
    toastShowrunner(_code, ev) {
      toasts.push(ev.msg);
    },
  };
};

interface Fixture {
  db: DB;
  content: ContentRepo;
  sessions: SessionRepo;
  events: EventRepo;
  emitter: ReturnType<typeof stubEmitter>;
  engine: GameEngine;
  teamIds: number[];
  questionIds: number[][];
  wagerQuestionId: number;
}

function buildFixture(): Fixture {
  const db = openDb(':memory:');
  const content = new ContentRepo(db);
  const sessions = new SessionRepo(db);
  const events = new EventRepo(db);

  const set = content.createSet('Test Set');
  const questionIds: number[][] = [];
  for (let c = 0; c < 2; c++) {
    const cat = content.createCategory(set.id, `Cat ${c + 1}`, c);
    const ids: number[] = [];
    for (let q = 0; q < 2; q++) {
      ids.push(
        content.createQuestion({
          categoryId: cat.id,
          sortOrder: q,
          prompt: `Prompt ${c}-${q}`,
          answer: `Answer ${c}-${q}`,
          value: 100,
          mediaUrl: null,
          notes: q === 0 ? 'be lenient' : null,
        }).id,
      );
    }
    questionIds.push(ids);
  }
  const finalCat = content.createCategory(set.id, 'Final Topic', 9);
  const wagerQuestionId = content.createQuestion({
    categoryId: finalCat.id,
    sortOrder: 0,
    prompt: 'Final prompt',
    answer: 'Final answer',
    value: 0,
    mediaUrl: null,
    notes: null,
  }).id;

  const categories = content.listCategories(set.id);
  const game = content.createGame('Test Game');
  content.createRound(game.id, 0, 'Board', {
    type: 'board',
    questionSetId: set.id,
    categoryIds: [categories[0]!.id, categories[1]!.id],
    values: [100, 200],
    wrongAnswerPenalty: true,
  });
  content.createRound(game.id, 1, 'Quickfire', {
    type: 'quickfire',
    questionSetId: set.id,
    categoryIds: [categories[0]!.id],
    pointsPerQuestion: 50,
    wrongAnswerPenalty: 25,
  });
  content.createRound(game.id, 2, 'Final', {
    type: 'wager',
    questionId: wagerQuestionId,
    maxWagerRule: 'all-in',
  });

  const session = sessions.create(game.id);
  const teamIds = ['Alpha', 'Bravo', 'Charlie'].map(
    (name, i) => sessions.createTeam(session.id, name, i).id,
  );
  teamIds.forEach((teamId, i) => sessions.setMapping(session.id, `B${i + 1}`, teamId));

  const emitter = stubEmitter();
  const engine = new GameEngine({ content, sessions, events, emitter }, session);
  return { db, content, sessions, events, emitter, engine, teamIds, questionIds, wagerQuestionId };
}

const sr = { role: 'showrunner' as const };
const host = { role: 'host' as const };

let f: Fixture;
beforeEach(() => {
  f = buildFixture();
});

const scores = () => new Map(f.engine.snapshot('audience').teams.map((t) => [t.id, t.score]));

describe('board round', () => {
  it('runs the full clue lifecycle with penalties, lockouts, and a reopen race', () => {
    const [t1, t2, t3] = f.teamIds as [number, number, number];
    f.engine.dispatch({ type: 'startGame' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 0 }, sr);
    f.engine.dispatch({ type: 'continue' }, host); // intro -> idle

    const q = f.questionIds[0]![0]!;
    f.engine.dispatch({ type: 'selectClue', questionId: q }, host);
    f.engine.dispatch({ type: 'openBuzzers' }, host);

    expect(f.engine.ingestBuzz('B1')).toMatchObject({ accepted: true, order: 1 });
    expect(f.engine.ingestBuzz('B2')).toMatchObject({ accepted: true, order: 2 });

    // Team 1 answers wrong: -100 and locked out, fresh race for the rest.
    f.engine.dispatch({ type: 'judge', correct: false }, host);
    expect(scores().get(t1)).toBe(-100);
    expect(f.engine.ingestBuzz('B1')).toMatchObject({ accepted: false, reason: 'locked-out' });
    expect(f.engine.ingestBuzz('B3')).toMatchObject({ accepted: true, order: 1 });

    f.engine.dispatch({ type: 'judge', correct: true }, host);
    expect(scores().get(t3)).toBe(100);
    expect(scores().get(t2)).toBe(0);

    const view = f.engine.snapshot('host').round as BoardRoundState;
    expect(view.phase).toBe('answer-reveal');
    expect(view.revealedAnswer).toBe('Answer 0-0');

    f.engine.dispatch({ type: 'continue' }, host);
    const idle = f.engine.snapshot('host').round as BoardRoundState;
    expect(idle.phase).toBe('idle');
    expect(idle.board[0]!.cells[0]!.used).toBe(true);
  });

  it('strips answers and notes for competitor and audience views', () => {
    f.engine.dispatch({ type: 'startGame' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 0 }, sr);
    f.engine.dispatch({ type: 'continue' }, host);
    f.engine.dispatch({ type: 'selectClue', questionId: f.questionIds[0]![0]! }, host);

    const hostView = f.engine.snapshot('host').round as BoardRoundState;
    expect(hostView.currentClue!.answer).toBe('Answer 0-0');
    expect(hostView.currentClue!.notes).toBe('be lenient');

    for (const role of ['competitor', 'audience'] as const) {
      const view = f.engine.snapshot(role, f.teamIds[0]).round as BoardRoundState;
      expect(view.currentClue!.prompt).toBe('Prompt 0-0');
      expect(view.currentClue!.answer).toBeNull();
      expect(view.currentClue!.notes).toBeNull();
    }
  });

  it('reveals with no points when every team misses', () => {
    f.engine.dispatch({ type: 'startGame' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 0 }, sr);
    f.engine.dispatch({ type: 'continue' }, host);
    f.engine.dispatch({ type: 'selectClue', questionId: f.questionIds[1]![1]! }, host);
    f.engine.dispatch({ type: 'openBuzzers' }, host);
    for (const b of ['B1', 'B2', 'B3']) {
      expect(f.engine.ingestBuzz(b).accepted).toBe(true);
      f.engine.dispatch({ type: 'judge', correct: false }, host);
    }
    const view = f.engine.snapshot('audience').round as BoardRoundState;
    expect(view.phase).toBe('answer-reveal');
    // Row 2 clue is worth 200 with penalties on.
    for (const t of f.engine.snapshot('audience').teams) expect(t.score).toBe(-200);
  });

  it('rejects invalid transitions and re-picking used clues', () => {
    f.engine.dispatch({ type: 'startGame' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 0 }, sr);
    expect(() => f.engine.dispatch({ type: 'openBuzzers' }, host)).toThrow(CommandError);
    f.engine.dispatch({ type: 'continue' }, host);
    const q = f.questionIds[0]![0]!;
    f.engine.dispatch({ type: 'selectClue', questionId: q }, host);
    f.engine.dispatch({ type: 'markDead' }, host);
    f.engine.dispatch({ type: 'continue' }, host);
    expect(() => f.engine.dispatch({ type: 'selectClue', questionId: q }, host)).toThrow(
      /already played/,
    );
  });

  it('enforces role permissions', () => {
    f.engine.dispatch({ type: 'startGame' }, sr);
    expect(() =>
      f.engine.dispatch({ type: 'startRound', roundIndex: 0 }, { role: 'host' }),
    ).toThrow(/may not/);
    expect(() =>
      f.engine.dispatch({ type: 'adjustScore', teamId: f.teamIds[0]!, delta: 5, reason: 'x' }, { role: 'audience' }),
    ).toThrow(/may not/);
  });

  it('ignores unmapped buzzers with a showrunner toast', () => {
    f.engine.dispatch({ type: 'startGame' }, sr);
    expect(f.engine.ingestBuzz('MYSTERY')).toMatchObject({ accepted: false, reason: 'unmapped' });
    expect(f.emitter.toasts.some((m) => m.includes('MYSTERY'))).toBe(true);
  });
});

describe('quickfire round', () => {
  it('advances sequentially and applies the flat penalty', () => {
    const [t1, t2] = f.teamIds as [number, number, number];
    f.engine.dispatch({ type: 'startGame' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 1 }, sr);
    f.engine.dispatch({ type: 'nextQuestion' }, host);

    let view = f.engine.snapshot('host').round as QuickfireRoundState;
    expect(view.phase).toBe('clue-shown');
    expect(view.totalQuestions).toBe(2);

    f.engine.dispatch({ type: 'openBuzzers' }, host);
    f.engine.ingestBuzz('B1');
    f.engine.dispatch({ type: 'judge', correct: false }, host);
    expect(scores().get(t1)).toBe(-25);
    f.engine.ingestBuzz('B2');
    f.engine.dispatch({ type: 'judge', correct: true }, host);
    expect(scores().get(t2)).toBe(50);

    f.engine.dispatch({ type: 'nextQuestion' }, host);
    f.engine.dispatch({ type: 'markDead' }, host);
    f.engine.dispatch({ type: 'continue' }, host);
    view = f.engine.snapshot('host').round as QuickfireRoundState;
    expect(view.phase).toBe('round-complete');
  });
});

describe('wager round', () => {
  function playToWagerRound(): void {
    const [t1, t2, t3] = f.teamIds as [number, number, number];
    f.engine.dispatch({ type: 'startGame' }, sr);
    // Seed scores so all-in maxima differ.
    f.engine.dispatch({ type: 'adjustScore', teamId: t1, delta: 500, reason: 'seed' }, sr);
    f.engine.dispatch({ type: 'adjustScore', teamId: t2, delta: 300, reason: 'seed' }, sr);
    f.engine.dispatch({ type: 'adjustScore', teamId: t3, delta: -100, reason: 'seed' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 2 }, sr);
    f.engine.dispatch({ type: 'continue' }, host); // intro -> wager-collect
  }

  it('clamps wagers, hides opponents data, and applies staged reveal scoring once', () => {
    const [t1, t2, t3] = f.teamIds as [number, number, number];
    playToWagerRound();

    let view = f.engine.snapshot('showrunner').round as WagerRoundState;
    expect(view.phase).toBe('wager-collect');
    expect(view.teams.find((t) => t.teamId === t1)!.maxWager).toBe(500);
    expect(view.teams.find((t) => t.teamId === t3)!.maxWager).toBe(0);

    f.engine.dispatch({ type: 'submitWager', amount: 9999 }, { role: 'competitor', teamId: t1 });
    f.engine.dispatch({ type: 'submitWager', amount: 200 }, { role: 'competitor', teamId: t2 });
    f.engine.dispatch({ type: 'setWager', teamId: t3, amount: 100 }, sr);

    view = f.engine.snapshot('showrunner').round as WagerRoundState;
    expect(view.teams.find((t) => t.teamId === t1)!.wager).toBe(500); // clamped
    expect(view.teams.find((t) => t.teamId === t3)!.wager).toBe(0); // clamped to 0

    // Competitor t2 must not see t1's wager; t1 sees its own.
    const t2View = f.engine.snapshot('competitor', t2).round as WagerRoundState;
    expect(t2View.teams.find((t) => t.teamId === t1)!.wager).toBeNull();
    expect(t2View.teams.find((t) => t.teamId === t2)!.wager).toBe(200);

    f.engine.dispatch({ type: 'lockWagers' }, host);
    f.engine.dispatch({ type: 'continue' }, host); // clue-shown -> answer-collect
    f.engine.dispatch({ type: 'submitAnswer', text: 'guess one' }, { role: 'competitor', teamId: t1 });
    f.engine.dispatch({ type: 'submitAnswer', text: 'guess two' }, { role: 'competitor', teamId: t2 });

    // Audience can't see answers before reveal.
    const audView = f.engine.snapshot('audience').round as WagerRoundState;
    expect(audView.teams.find((t) => t.teamId === t1)!.answer).toBeNull();
    expect(audView.clue!.answer).toBeNull();

    f.engine.dispatch({ type: 'lockAnswers' }, host);

    // Staged reveal for team 1: answer -> judged -> wager+score.
    f.engine.dispatch({ type: 'revealTeam', teamId: t1 }, host);
    f.engine.dispatch({ type: 'judgeWager', teamId: t1, correct: true }, host);
    f.engine.dispatch({ type: 'revealStep' }, host);
    expect(scores().get(t1)).toBe(1000);

    f.engine.dispatch({ type: 'revealTeam', teamId: t2 }, host);
    f.engine.dispatch({ type: 'judgeWager', teamId: t2, correct: false }, host);
    f.engine.dispatch({ type: 'revealStep' }, host);
    expect(scores().get(t2)).toBe(100);

    f.engine.dispatch({ type: 'revealTeam', teamId: t3 }, host);
    f.engine.dispatch({ type: 'judgeWager', teamId: t3, correct: false }, host);
    f.engine.dispatch({ type: 'revealStep' }, host);
    expect(scores().get(t3)).toBe(-100); // wagered 0

    f.engine.dispatch({ type: 'continue' }, host);
    view = f.engine.snapshot('showrunner').round as WagerRoundState;
    expect(view.phase).toBe('round-complete');

    f.engine.dispatch({ type: 'endGame' }, sr);
    expect(f.engine.snapshot('audience').status).toBe('finished');
  });

  it('requires judging before the wager reveal step', () => {
    const [t1] = f.teamIds as [number, number, number];
    playToWagerRound();
    f.engine.dispatch({ type: 'lockWagers' }, host);
    f.engine.dispatch({ type: 'continue' }, host);
    f.engine.dispatch({ type: 'lockAnswers' }, host);
    f.engine.dispatch({ type: 'revealTeam', teamId: t1 }, host);
    expect(() => f.engine.dispatch({ type: 'revealStep' }, host)).toThrow(/Judge the answer/);
  });
});

describe('recovery', () => {
  it('rebuilds mid-judging state and scores by replaying the journal', () => {
    const [t1] = f.teamIds as [number, number, number];
    f.engine.dispatch({ type: 'startGame' }, sr);
    f.engine.dispatch({ type: 'startRound', roundIndex: 0 }, sr);
    f.engine.dispatch({ type: 'continue' }, host);
    f.engine.dispatch({ type: 'selectClue', questionId: f.questionIds[0]![0]! }, host);
    f.engine.dispatch({ type: 'openBuzzers' }, host);
    f.engine.ingestBuzz('B1');
    f.engine.dispatch({ type: 'judge', correct: false }, host);
    f.engine.ingestBuzz('B2');

    // "Restart": a brand-new engine over the same DB replays the journal.
    const session = f.sessions.getByCode(f.engine.code)!;
    const revived = new GameEngine(
      { content: f.content, sessions: f.sessions, events: f.events, emitter: stubEmitter() },
      session,
    );
    revived.replayJournal();

    const snap = revived.snapshot('host');
    expect(snap.status).toBe('live');
    expect(snap.roundIndex).toBe(0);
    const round = snap.round as BoardRoundState;
    expect(round.phase).toBe('judging');
    expect(snap.buzz!.answeringTeamId).toBe(f.teamIds[1]);
    expect(snap.buzz!.lockedTeamIds).toContain(t1);
    expect(snap.teams.find((t) => t.id === t1)!.score).toBe(-100);

    // The revived engine keeps working.
    revived.dispatch({ type: 'judge', correct: true }, host);
    expect(revived.snapshot('host').teams.find((t) => t.id === f.teamIds[1])!.score).toBe(100);
  });
});
