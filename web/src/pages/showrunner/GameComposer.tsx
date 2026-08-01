import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  Category,
  Game,
  GameRound,
  Question,
  QuestionSet,
  RoundConfig,
} from '@trivia/shared';
import { api, ApiError } from '../../lib/api';

type GameDetail = Game & { rounds: GameRound[] };
type SetDetail = QuestionSet & { categories: (Category & { questions: Question[] })[] };

export default function GameComposer() {
  const { id } = useParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [setDetails, setSetDetails] = useState<Record<number, SetDetail>>({});
  const [error, setError] = useState<string | null>(null);

  // Guard against out-of-order responses: rapid round saves fire concurrent
  // refreshes, and an older response must not overwrite newer game state
  // (round cards resync their drafts from it).
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [nextGame, nextSets] = await Promise.all([
      api.get<GameDetail>(`/api/games/${id}`),
      api.get<QuestionSet[]>('/api/question-sets'),
    ]);
    if (generation !== refreshGeneration.current) return;
    setGame(nextGame);
    setSets(nextSets);
  }, [id]);

  useEffect(() => {
    setGame(null);
    refresh().catch((e) => setError((e as Error).message));
  }, [refresh]);

  // Stable identity + in-flight dedupe; failures surface via the error toast
  // (call sites fire-and-forget) and allow a retry.
  const loadingSets = useRef(new Set<number>());
  const loadSet = useCallback(async (setId: number) => {
    if (loadingSets.current.has(setId)) return;
    loadingSets.current.add(setId);
    try {
      const detail = await api.get<SetDetail>(`/api/question-sets/${setId}`);
      setSetDetails((prev) => ({ ...prev, [setId]: detail }));
    } catch (e) {
      loadingSets.current.delete(setId);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!game) return;
    for (const round of game.rounds) {
      const setId =
        round.config.type === 'wager' ? null : round.config.questionSetId;
      if (setId) void loadSet(setId);
    }
    // Wager rounds reference a question directly; WagerConfigForm resolves it.
  }, [game, loadSet]);

  if (!game) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <div className="spread">
        <h1>{game.name}</h1>
        <Link to="/console">← Console</Link>
      </div>
      {error && <div className="toast error">{error}</div>}
      <p className="muted">Rounds play in order. Configure each round below.</p>

      {game.rounds.map((round, i) => (
        <RoundCard
          key={round.id}
          round={round}
          index={i}
          sets={sets}
          setDetails={setDetails}
          loadSet={loadSet}
          onChanged={refresh}
          onError={setError}
        />
      ))}

      <div className="panel row">
        <span>Add round:</span>
        {(['board', 'quickfire', 'wager'] as const).map((type) => (
          <button
            key={type}
            className="primary"
            onClick={() => {
              const defaults: Record<string, RoundConfig> = {
                board: { type: 'board', questionSetId: 0, categoryIds: [], values: [100, 200, 300, 400, 500], wrongAnswerPenalty: true },
                quickfire: { type: 'quickfire', questionSetId: 0, categoryIds: [], pointsPerQuestion: 100, wrongAnswerPenalty: 0 },
                wager: { type: 'wager', questionId: 0, maxWagerRule: 'all-in' },
              };
              api
                .post(`/api/games/${game.id}/rounds`, {
                  sortOrder: game.rounds.length,
                  title: `Round ${game.rounds.length + 1}`,
                  config: defaults[type],
                })
                .then(refresh)
                .catch((e) => setError((e as Error).message));
            }}
          >
            + {type}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundCard({
  round,
  index,
  sets,
  setDetails,
  loadSet,
  onChanged,
  onError,
}: {
  round: GameRound;
  index: number;
  sets: QuestionSet[];
  setDetails: Record<number, SetDetail>;
  loadSet: (id: number) => Promise<void>;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(round.title);
  const [config, setConfig] = useState<RoundConfig>(round.config);
  // Board row values are edited as raw text and parsed on save — parsing per
  // keystroke would eat the comma the user just typed.
  const [valuesText, setValuesText] = useState(
    round.config.type === 'board' ? round.config.values.join(',') : '',
  );

  // Resync local drafts when the server truth for this round changes (e.g.
  // after a save normalizes the config) without clobbering unrelated edits.
  const serverConfig = JSON.stringify(round.config);
  useEffect(() => {
    setTitle(round.title);
    setConfig(round.config);
    setValuesText(round.config.type === 'board' ? round.config.values.join(',') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id, round.title, round.sortOrder, serverConfig]);

  const parseValues = (text: string): number[] =>
    text
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0);

  const save = () => {
    const finalConfig = config.type === 'board' ? { ...config, values: parseValues(valuesText) } : config;
    return api
      .put(`/api/rounds/${round.id}`, { title, config: finalConfig, sortOrder: round.sortOrder })
      .then(onChanged)
      .catch((e) => onError((e as Error).message));
  };

  const remove = () => {
    if (!confirm(`Delete round "${round.title}"?`)) return;
    api
      .del(`/api/rounds/${round.id}`)
      .then(onChanged)
      .catch((e) => onError((e as Error).message));
  };

  return (
    <div className="panel">
      <div className="spread">
        <div className="row">
          <span className="tag">{index + 1}</span>
          <span className="tag">{round.roundType}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="row">
          <button className="primary" onClick={save}>
            Save round
          </button>
          <button className="danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      {config.type !== 'wager' && (
        <SetAndCategories
          config={config}
          sets={sets}
          setDetails={setDetails}
          loadSet={loadSet}
          onChange={(next) => setConfig(next)}
        />
      )}

      {config.type === 'board' && (
        <div className="row" style={{ marginTop: 10 }}>
          <label>
            Row values{' '}
            <input
              style={{ width: 220 }}
              value={valuesText}
              placeholder="100,200,300,400,500"
              onChange={(e) => setValuesText(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.wrongAnswerPenalty}
              onChange={(e) => setConfig({ ...config, wrongAnswerPenalty: e.target.checked })}
            />{' '}
            Deduct value on wrong answers
          </label>
        </div>
      )}

      {config.type === 'quickfire' && (
        <div className="row" style={{ marginTop: 10 }}>
          <label>
            Points per question{' '}
            <input
              type="number"
              style={{ width: 90 }}
              value={config.pointsPerQuestion}
              onChange={(e) => setConfig({ ...config, pointsPerQuestion: Number(e.target.value) })}
            />
          </label>
          <label>
            Wrong-answer penalty{' '}
            <input
              type="number"
              style={{ width: 90 }}
              value={config.wrongAnswerPenalty}
              onChange={(e) => setConfig({ ...config, wrongAnswerPenalty: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      {config.type === 'wager' && (
        <WagerConfigForm
          config={config}
          sets={sets}
          setDetails={setDetails}
          loadSet={loadSet}
          onChange={setConfig}
          onError={onError}
        />
      )}
    </div>
  );
}

function SetAndCategories({
  config,
  sets,
  setDetails,
  loadSet,
  onChange,
}: {
  config: Extract<RoundConfig, { type: 'board' | 'quickfire' }>;
  sets: QuestionSet[];
  setDetails: Record<number, SetDetail>;
  loadSet: (id: number) => Promise<void>;
  onChange: (c: Extract<RoundConfig, { type: 'board' | 'quickfire' }>) => void;
}) {
  const detail = config.questionSetId ? setDetails[config.questionSetId] : undefined;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="row">
        <label>
          Question set{' '}
          <select
            value={config.questionSetId || ''}
            onChange={(e) => {
              const setId = Number(e.target.value);
              onChange({ ...config, questionSetId: setId, categoryIds: [] });
              if (setId) void loadSet(setId);
            }}
          >
            <option value="">Pick…</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {detail && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted small">Categories (in play order):</span>
          {detail.categories.map((c) => (
            <label key={c.id} className="tag" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.categoryIds.includes(c.id)}
                onChange={(e) =>
                  onChange({
                    ...config,
                    categoryIds: e.target.checked
                      ? [...config.categoryIds, c.id]
                      : config.categoryIds.filter((id) => id !== c.id),
                  })
                }
              />{' '}
              {c.name} ({c.questions.length})
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function WagerConfigForm({
  config,
  sets,
  setDetails,
  loadSet,
  onChange,
  onError,
}: {
  config: Extract<RoundConfig, { type: 'wager' }>;
  sets: QuestionSet[];
  setDetails: Record<number, SetDetail>;
  loadSet: (id: number) => Promise<void>;
  onChange: (c: Extract<RoundConfig, { type: 'wager' }>) => void;
  onError: (msg: string) => void;
}) {
  const [pickSetId, setPickSetId] = useState<number>(0);
  const [saved, setSaved] = useState<(Question & { categoryName: string; questionSetId: number | null }) | null>(null);
  const [savedMissing, setSavedMissing] = useState(false);
  const detail = pickSetId ? setDetails[pickSetId] : undefined;
  const allQuestions = detail?.categories.flatMap((c) => c.questions.map((q) => ({ q, cat: c.name }))) ?? [];

  // Resolve the saved question directly — a stored wager round must show its
  // question (or a deleted-question warning) without the user browsing sets.
  useEffect(() => {
    if (!config.questionId) {
      setSaved(null);
      setSavedMissing(false);
      return;
    }
    let cancelled = false;
    api
      .get<Question & { categoryName: string; questionSetId: number | null }>(`/api/questions/${config.questionId}`)
      .then((q) => {
        if (cancelled) return;
        setSaved(q);
        setSavedMissing(false);
        if (q.questionSetId) {
          setPickSetId((prev) => prev || q.questionSetId!);
          void loadSet(q.questionSetId);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setSaved(null);
        // Only a definitive 404 means the question was deleted; a transient
        // failure must not scare the operator into re-picking the question.
        if (err instanceof ApiError && err.status === 404) {
          setSavedMissing(true);
        } else {
          setSavedMissing(false);
          onError((err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config.questionId, loadSet, onError]);

  return (
    <div style={{ marginTop: 10 }} className="stack">
      <div className="row">
        <label>
          Browse set{' '}
          <select
            value={pickSetId || ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              setPickSetId(id);
              if (id) void loadSet(id);
            }}
          >
            <option value="">Pick…</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {detail && (
          <label>
            Final question{' '}
            <select value={config.questionId || ''} onChange={(e) => onChange({ ...config, questionId: Number(e.target.value) })}>
              <option value="">Pick…</option>
              {allQuestions.map(({ q, cat }) => (
                <option key={q.id} value={q.id}>
                  [{cat}] {q.prompt.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {saved && (
        <div className="muted small">
          Selected: [{saved.categoryName}] {saved.prompt}
        </div>
      )}
      {savedMissing && (
        <div className="toast error">
          The saved final question no longer exists — pick a new one before running this round.
        </div>
      )}
      <div className="row">
        <label>
          Max wager rule{' '}
          <select
            value={config.maxWagerRule}
            onChange={(e) => onChange({ ...config, maxWagerRule: e.target.value as 'all-in' | 'cap' })}
          >
            <option value="all-in">All-in (up to current score)</option>
            <option value="cap">Fixed cap</option>
          </select>
        </label>
        {config.maxWagerRule === 'cap' && (
          <label>
            Cap{' '}
            <input
              type="number"
              style={{ width: 100 }}
              value={config.cap ?? 0}
              onChange={(e) => onChange({ ...config, cap: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
    </div>
  );
}
