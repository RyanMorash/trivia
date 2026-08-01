import { Router } from 'express';
import type { RoundConfig } from '@trivia/shared';
import type { ContentRepo } from '../db/repos/contentRepo.js';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const int = (v: unknown, fallback = 0): number =>
  Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback;

interface ImportQuestion {
  prompt?: string;
  answer?: string;
  value?: number;
  notes?: string;
  mediaUrl?: string;
}
interface ImportCategory {
  name?: string;
  questions?: ImportQuestion[];
}
interface ImportSet {
  name?: string;
  description?: string;
  categories?: ImportCategory[];
}

export function contentRouter(content: ContentRepo): Router {
  const r = Router();

  // ---- question sets --------------------------------------------------------

  r.get('/question-sets', (_req, res) => res.json(content.listSets()));

  r.post('/question-sets', (req, res) => {
    const name = str(req.body?.name).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(content.createSet(name, str(req.body?.description)));
  });

  r.get('/question-sets/:id', (req, res) => {
    const set = content.getSet(int(req.params.id));
    if (!set) return res.status(404).json({ error: 'not found' });
    const categories = content.listCategories(set.id).map((c) => ({
      ...c,
      questions: content.listQuestions(c.id),
    }));
    res.json({ ...set, categories });
  });

  r.put('/question-sets/:id', (req, res) => {
    const set = content.getSet(int(req.params.id));
    if (!set) return res.status(404).json({ error: 'not found' });
    content.updateSet(set.id, str(req.body?.name, set.name), str(req.body?.description, set.description));
    res.json(content.getSet(set.id));
  });

  r.delete('/question-sets/:id', (req, res) => {
    content.deleteSet(int(req.params.id));
    res.json({ ok: true });
  });

  // JSON import/export — the realistic way to author a full event's questions.
  r.post('/question-sets/import', (req, res) => {
    const body = req.body as ImportSet;
    const name = str(body?.name).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const set = content.createSet(name, str(body.description));
    (body.categories ?? []).forEach((cat, ci) => {
      const category = content.createCategory(set.id, str(cat.name, `Category ${ci + 1}`), ci);
      (cat.questions ?? []).forEach((q, qi) => {
        content.createQuestion({
          categoryId: category.id,
          sortOrder: qi,
          prompt: str(q.prompt),
          answer: str(q.answer),
          value: int(q.value, 100),
          mediaUrl: q.mediaUrl ? str(q.mediaUrl) : null,
          notes: q.notes ? str(q.notes) : null,
        });
      });
    });
    res.status(201).json(content.getSet(set.id));
  });

  r.get('/question-sets/:id/export', (req, res) => {
    const set = content.getSet(int(req.params.id));
    if (!set) return res.status(404).json({ error: 'not found' });
    res.json({
      name: set.name,
      description: set.description,
      categories: content.listCategories(set.id).map((c) => ({
        name: c.name,
        questions: content.listQuestions(c.id).map((q) => ({
          prompt: q.prompt,
          answer: q.answer,
          value: q.value,
          notes: q.notes ?? undefined,
          mediaUrl: q.mediaUrl ?? undefined,
        })),
      })),
    });
  });

  // ---- categories -----------------------------------------------------------

  r.post('/question-sets/:id/categories', (req, res) => {
    const set = content.getSet(int(req.params.id));
    if (!set) return res.status(404).json({ error: 'not found' });
    const name = str(req.body?.name).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(content.createCategory(set.id, name, int(req.body?.sortOrder)));
  });

  r.put('/categories/:id', (req, res) => {
    const cat = content.getCategory(int(req.params.id));
    if (!cat) return res.status(404).json({ error: 'not found' });
    content.updateCategory(cat.id, str(req.body?.name, cat.name), int(req.body?.sortOrder, cat.sortOrder));
    res.json(content.getCategory(cat.id));
  });

  r.delete('/categories/:id', (req, res) => {
    content.deleteCategory(int(req.params.id));
    res.json({ ok: true });
  });

  // ---- questions ------------------------------------------------------------

  r.post('/categories/:id/questions', (req, res) => {
    const cat = content.getCategory(int(req.params.id));
    if (!cat) return res.status(404).json({ error: 'not found' });
    res.status(201).json(
      content.createQuestion({
        categoryId: cat.id,
        sortOrder: int(req.body?.sortOrder),
        prompt: str(req.body?.prompt),
        answer: str(req.body?.answer),
        value: int(req.body?.value, 100),
        mediaUrl: req.body?.mediaUrl ? str(req.body.mediaUrl) : null,
        notes: req.body?.notes ? str(req.body.notes) : null,
      }),
    );
  });

  r.put('/questions/:id', (req, res) => {
    const q = content.getQuestion(int(req.params.id));
    if (!q) return res.status(404).json({ error: 'not found' });
    content.updateQuestion(q.id, {
      sortOrder: int(req.body?.sortOrder, q.sortOrder),
      prompt: str(req.body?.prompt, q.prompt),
      answer: str(req.body?.answer, q.answer),
      value: int(req.body?.value, q.value),
      mediaUrl: req.body?.mediaUrl !== undefined ? (req.body.mediaUrl ? str(req.body.mediaUrl) : null) : q.mediaUrl,
      notes: req.body?.notes !== undefined ? (req.body.notes ? str(req.body.notes) : null) : q.notes,
    });
    res.json(content.getQuestion(q.id));
  });

  r.delete('/questions/:id', (req, res) => {
    content.deleteQuestion(int(req.params.id));
    res.json({ ok: true });
  });

  // ---- games + rounds -------------------------------------------------------

  r.get('/games', (_req, res) => res.json(content.listGames()));

  r.post('/games', (req, res) => {
    const name = str(req.body?.name).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(content.createGame(name));
  });

  r.get('/games/:id', (req, res) => {
    const game = content.getGame(int(req.params.id));
    if (!game) return res.status(404).json({ error: 'not found' });
    res.json({ ...game, rounds: content.listRounds(game.id) });
  });

  r.put('/games/:id', (req, res) => {
    const game = content.getGame(int(req.params.id));
    if (!game) return res.status(404).json({ error: 'not found' });
    content.updateGame(game.id, str(req.body?.name, game.name));
    res.json(content.getGame(game.id));
  });

  r.delete('/games/:id', (req, res) => {
    content.deleteGame(int(req.params.id));
    res.json({ ok: true });
  });

  r.post('/games/:id/rounds', (req, res) => {
    const game = content.getGame(int(req.params.id));
    if (!game) return res.status(404).json({ error: 'not found' });
    const config = req.body?.config as RoundConfig | undefined;
    if (!config || !['board', 'quickfire', 'wager'].includes(config.type)) {
      return res.status(400).json({ error: 'config with a valid type is required' });
    }
    res
      .status(201)
      .json(content.createRound(game.id, int(req.body?.sortOrder), str(req.body?.title, 'Round'), config));
  });

  r.put('/rounds/:id', (req, res) => {
    const round = content.getRound(int(req.params.id));
    if (!round) return res.status(404).json({ error: 'not found' });
    const config = (req.body?.config as RoundConfig | undefined) ?? round.config;
    content.updateRound(round.id, int(req.body?.sortOrder, round.sortOrder), str(req.body?.title, round.title), config);
    res.json(content.getRound(round.id));
  });

  r.delete('/rounds/:id', (req, res) => {
    content.deleteRound(int(req.params.id));
    res.json({ ok: true });
  });

  return r;
}
