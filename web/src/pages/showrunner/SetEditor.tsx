import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Category, Question, QuestionSet } from '@trivia/shared';
import { api } from '../../lib/api';

type SetDetail = QuestionSet & { categories: (Category & { questions: Question[] })[] };

export default function SetEditor() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SetDetail | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDetail(await api.get<SetDetail>(`/api/question-sets/${id}`));
  }, [id]);

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, [refresh]);

  const guard = (fn: () => Promise<void>) => () =>
    fn()
      .then(() => setError(null))
      .catch((e) => setError((e as Error).message));

  if (!detail) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <div className="spread">
        <h1>{detail.name}</h1>
        <Link to="/console">← Console</Link>
      </div>
      {error && <div className="toast error">{error}</div>}

      {detail.categories.map((cat) => (
        <div key={cat.id} className="panel">
          <div className="spread">
            <h2>{cat.name}</h2>
            <button
              className="danger small"
              onClick={guard(async () => {
                if (!confirm(`Delete category "${cat.name}"?`)) return;
                await api.del(`/api/categories/${cat.id}`);
                await refresh();
              })}
            >
              Delete category
            </button>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: '35%' }}>Prompt (read aloud)</th>
                <th style={{ width: '25%' }}>Answer</th>
                <th style={{ width: 70 }}>Value</th>
                <th>Host notes</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {cat.questions.map((q) => (
                <QuestionRow key={q.id} q={q} onSaved={refresh} onError={setError} />
              ))}
              <NewQuestionRow categoryId={cat.id} nextOrder={cat.questions.length} onSaved={refresh} onError={setError} />
            </tbody>
          </table>
        </div>
      ))}

      <div className="panel row">
        <input placeholder="New category name" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
        <button
          className="primary"
          disabled={!newCatName.trim()}
          onClick={guard(async () => {
            await api.post(`/api/question-sets/${detail.id}/categories`, {
              name: newCatName.trim(),
              sortOrder: detail.categories.length,
            });
            setNewCatName('');
            await refresh();
          })}
        >
          Add category
        </button>
      </div>
    </div>
  );
}

function QuestionRow({
  q,
  onSaved,
  onError,
}: {
  q: Question;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(q);
  // Resync when the server truth for this question changes (a save elsewhere
  // triggered a refresh); dep values only change when the row itself changed.
  useEffect(() => {
    setDraft(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id, q.prompt, q.answer, q.value, q.notes, q.sortOrder]);
  const dirty =
    draft.prompt !== q.prompt || draft.answer !== q.answer || draft.value !== q.value || draft.notes !== q.notes;

  return (
    <tr>
      <td>
        <textarea rows={2} style={{ width: '100%' }} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
      </td>
      <td>
        <textarea rows={2} style={{ width: '100%' }} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
      </td>
      <td>
        <input
          type="number"
          style={{ width: 70 }}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
        />
      </td>
      <td>
        <input
          style={{ width: '100%' }}
          value={draft.notes ?? ''}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
        />
      </td>
      <td>
        <div className="row">
          <button
            disabled={!dirty}
            onClick={() =>
              api
                .put(`/api/questions/${q.id}`, draft)
                .then(onSaved)
                .catch((e) => onError((e as Error).message))
            }
          >
            Save
          </button>
          <button
            className="danger"
            onClick={() => {
              if (!confirm('Delete question?')) return;
              api
                .del(`/api/questions/${q.id}`)
                .then(onSaved)
                .catch((e) => onError((e as Error).message));
            }}
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

function NewQuestionRow({
  categoryId,
  nextOrder,
  onSaved,
  onError,
}: {
  categoryId: number;
  nextOrder: number;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const empty = { prompt: '', answer: '', value: 100, notes: '' };
  const [draft, setDraft] = useState(empty);

  return (
    <tr>
      <td>
        <textarea rows={2} style={{ width: '100%' }} placeholder="New question prompt…" value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
      </td>
      <td>
        <textarea rows={2} style={{ width: '100%' }} placeholder="Answer" value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
      </td>
      <td>
        <input type="number" style={{ width: 70 }} value={draft.value} onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })} />
      </td>
      <td>
        <input style={{ width: '100%' }} placeholder="Optional host note" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </td>
      <td>
        <button
          className="primary"
          disabled={!draft.prompt.trim() || !draft.answer.trim()}
          onClick={() =>
            api
              .post(`/api/categories/${categoryId}/questions`, { ...draft, sortOrder: nextOrder, notes: draft.notes || null })
              .then(() => {
                setDraft(empty);
                return onSaved();
              })
              .catch((e) => onError((e as Error).message))
          }
        >
          Add
        </button>
      </td>
    </tr>
  );
}
