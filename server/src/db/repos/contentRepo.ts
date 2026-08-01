import type {
  Category,
  Game,
  GameRound,
  Question,
  QuestionSet,
  RoundConfig,
} from '@trivia/shared';
import type { DB } from '../connection.js';

interface SetRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
}
interface CategoryRow {
  id: number;
  question_set_id: number;
  name: string;
  sort_order: number;
}
interface QuestionRow {
  id: number;
  category_id: number;
  sort_order: number;
  prompt: string;
  answer: string;
  value: number;
  media_url: string | null;
  notes: string | null;
}
interface GameRow {
  id: number;
  name: string;
  created_at: string;
}
interface RoundRow {
  id: number;
  game_id: number;
  sort_order: number;
  round_type: string;
  title: string;
  config_json: string;
}

const toSet = (r: SetRow): QuestionSet => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
});
const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  questionSetId: r.question_set_id,
  name: r.name,
  sortOrder: r.sort_order,
});
const toQuestion = (r: QuestionRow): Question => ({
  id: r.id,
  categoryId: r.category_id,
  sortOrder: r.sort_order,
  prompt: r.prompt,
  answer: r.answer,
  value: r.value,
  mediaUrl: r.media_url,
  notes: r.notes,
});
const toGame = (r: GameRow): Game => ({ id: r.id, name: r.name, createdAt: r.created_at });
const toRound = (r: RoundRow): GameRound => ({
  id: r.id,
  gameId: r.game_id,
  sortOrder: r.sort_order,
  roundType: r.round_type as GameRound['roundType'],
  title: r.title,
  config: JSON.parse(r.config_json) as RoundConfig,
});

export class ContentRepo {
  constructor(private db: DB) {}

  // ---- question sets --------------------------------------------------------

  listSets(): QuestionSet[] {
    return (this.db.prepare('SELECT * FROM question_sets ORDER BY id').all() as SetRow[]).map(toSet);
  }

  getSet(id: number): QuestionSet | null {
    const r = this.db.prepare('SELECT * FROM question_sets WHERE id = ?').get(id) as SetRow | undefined;
    return r ? toSet(r) : null;
  }

  createSet(name: string, description = ''): QuestionSet {
    const info = this.db
      .prepare('INSERT INTO question_sets (name, description) VALUES (?, ?)')
      .run(name, description);
    return this.getSet(Number(info.lastInsertRowid))!;
  }

  updateSet(id: number, name: string, description: string): void {
    this.db.prepare('UPDATE question_sets SET name = ?, description = ? WHERE id = ?').run(name, description, id);
  }

  deleteSet(id: number): void {
    this.db.prepare('DELETE FROM question_sets WHERE id = ?').run(id);
  }

  // ---- categories -----------------------------------------------------------

  listCategories(questionSetId: number): Category[] {
    return (
      this.db
        .prepare('SELECT * FROM categories WHERE question_set_id = ? ORDER BY sort_order, id')
        .all(questionSetId) as CategoryRow[]
    ).map(toCategory);
  }

  getCategory(id: number): Category | null {
    const r = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
    return r ? toCategory(r) : null;
  }

  createCategory(questionSetId: number, name: string, sortOrder: number): Category {
    const info = this.db
      .prepare('INSERT INTO categories (question_set_id, name, sort_order) VALUES (?, ?, ?)')
      .run(questionSetId, name, sortOrder);
    return this.getCategory(Number(info.lastInsertRowid))!;
  }

  updateCategory(id: number, name: string, sortOrder: number): void {
    this.db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(name, sortOrder, id);
  }

  deleteCategory(id: number): void {
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  // ---- questions ------------------------------------------------------------

  listQuestions(categoryId: number): Question[] {
    return (
      this.db
        .prepare('SELECT * FROM questions WHERE category_id = ? ORDER BY sort_order, id')
        .all(categoryId) as QuestionRow[]
    ).map(toQuestion);
  }

  getQuestion(id: number): Question | null {
    const r = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined;
    return r ? toQuestion(r) : null;
  }

  createQuestion(q: Omit<Question, 'id'>): Question {
    const info = this.db
      .prepare(
        `INSERT INTO questions (category_id, sort_order, prompt, answer, value, media_url, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(q.categoryId, q.sortOrder, q.prompt, q.answer, q.value, q.mediaUrl, q.notes);
    return this.getQuestion(Number(info.lastInsertRowid))!;
  }

  updateQuestion(id: number, q: Omit<Question, 'id' | 'categoryId'>): void {
    this.db
      .prepare(
        `UPDATE questions SET sort_order = ?, prompt = ?, answer = ?, value = ?, media_url = ?, notes = ?
         WHERE id = ?`,
      )
      .run(q.sortOrder, q.prompt, q.answer, q.value, q.mediaUrl, q.notes, id);
  }

  deleteQuestion(id: number): void {
    this.db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  }

  // ---- games + rounds -------------------------------------------------------

  listGames(): Game[] {
    return (this.db.prepare('SELECT * FROM games ORDER BY id').all() as GameRow[]).map(toGame);
  }

  getGame(id: number): Game | null {
    const r = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    return r ? toGame(r) : null;
  }

  createGame(name: string): Game {
    const info = this.db.prepare('INSERT INTO games (name) VALUES (?)').run(name);
    return this.getGame(Number(info.lastInsertRowid))!;
  }

  updateGame(id: number, name: string): void {
    this.db.prepare('UPDATE games SET name = ? WHERE id = ?').run(name, id);
  }

  deleteGame(id: number): void {
    this.db.prepare('DELETE FROM games WHERE id = ?').run(id);
  }

  listRounds(gameId: number): GameRound[] {
    return (
      this.db
        .prepare('SELECT * FROM game_rounds WHERE game_id = ? ORDER BY sort_order, id')
        .all(gameId) as RoundRow[]
    ).map(toRound);
  }

  getRound(id: number): GameRound | null {
    const r = this.db.prepare('SELECT * FROM game_rounds WHERE id = ?').get(id) as RoundRow | undefined;
    return r ? toRound(r) : null;
  }

  createRound(gameId: number, sortOrder: number, title: string, config: RoundConfig): GameRound {
    const info = this.db
      .prepare('INSERT INTO game_rounds (game_id, sort_order, round_type, title, config_json) VALUES (?, ?, ?, ?, ?)')
      .run(gameId, sortOrder, config.type, title, JSON.stringify(config));
    return this.getRound(Number(info.lastInsertRowid))!;
  }

  updateRound(id: number, sortOrder: number, title: string, config: RoundConfig): void {
    this.db
      .prepare('UPDATE game_rounds SET sort_order = ?, round_type = ?, title = ?, config_json = ? WHERE id = ?')
      .run(sortOrder, config.type, title, JSON.stringify(config), id);
  }

  deleteRound(id: number): void {
    this.db.prepare('DELETE FROM game_rounds WHERE id = ?').run(id);
  }
}
