import type {
  BoardCategoryView,
  BoardRoundConfig,
  BoardRoundState,
  Command,
  Question,
  Role,
} from '@trivia/shared';
import type { ContentRepo } from '../../db/repos/contentRepo.js';
import { clueView, JudgingRoundBase } from './judgingBase.js';
import { CommandError, type Actor, type EngineCtx, type RoundHandler } from './RoundType.js';

const DEFAULT_VALUES = [100, 200, 300, 400, 500];

interface BoardCell {
  question: Question;
  boardValue: number;
  used: boolean;
}

interface BoardColumn {
  categoryId: number;
  name: string;
  cells: BoardCell[];
}

export class BoardRound extends JudgingRoundBase implements RoundHandler {
  readonly type = 'board';
  private columns: BoardColumn[] = [];
  private current: { cell: BoardCell; categoryName: string } | null = null;
  private penalty: boolean;

  constructor(config: BoardRoundConfig, content: ContentRepo) {
    super();
    this.penalty = config.wrongAnswerPenalty;
    const values = config.values.length > 0 ? config.values : DEFAULT_VALUES;
    for (const categoryId of config.categoryIds) {
      const category = content.getCategory(categoryId);
      if (!category) continue;
      const questions = content.listQuestions(categoryId).slice(0, values.length);
      this.columns.push({
        categoryId,
        name: category.name,
        cells: questions.map((question, i) => ({
          question,
          boardValue: values[i] ?? question.value,
          used: false,
        })),
      });
    }
  }

  protected currentQuestion(): Question | null {
    return this.current?.cell.question ?? null;
  }
  protected currentValue(): number {
    return this.current?.cell.boardValue ?? 0;
  }
  protected penaltyValue(): number {
    return this.penalty ? this.currentValue() : 0;
  }
  protected consumeCurrent(): void {
    if (this.current) this.current.cell.used = true;
  }

  handleCommand(cmd: Command, _actor: Actor, ctx: EngineCtx): void {
    switch (cmd.type) {
      case 'continue':
        if (this.phase === 'round-intro') {
          this.phase = 'idle';
        } else if (this.phase === 'answer-reveal') {
          this.current = null;
          this.revealedAnswer = null;
          this.phase = this.boardExhausted() ? 'round-complete' : 'idle';
        } else {
          throw new CommandError('Nothing to continue from');
        }
        break;
      case 'selectClue': {
        if (this.phase !== 'idle') throw new CommandError('Cannot select a clue right now');
        const found = this.findCell(cmd.questionId);
        if (!found) throw new CommandError('Unknown clue');
        if (found.cell.used) throw new CommandError('Clue already played');
        this.current = found;
        this.startClue();
        break;
      }
      case 'openBuzzers':
        this.openBuzzers(ctx);
        break;
      case 'closeBuzzers':
        this.closeBuzzers(ctx);
        break;
      case 'judge':
        this.judge(cmd.correct, ctx.currentAnsweringTeamId(), ctx);
        break;
      case 'markDead':
        this.markDead(ctx);
        break;
      case 'clearLockouts':
        this.clearLockouts(ctx);
        break;
      default:
        throw new CommandError(`Command ${cmd.type} not valid in a board round`);
    }
  }

  private findCell(questionId: number): { cell: BoardCell; categoryName: string } | null {
    for (const col of this.columns) {
      const cell = col.cells.find((c) => c.question.id === questionId);
      if (cell) return { cell, categoryName: col.name };
    }
    return null;
  }

  private boardExhausted(): boolean {
    return this.columns.every((col) => col.cells.every((c) => c.used));
  }

  isComplete(): boolean {
    return this.phase === 'round-complete';
  }

  view(role: Role): BoardRoundState {
    const board: BoardCategoryView[] = this.columns.map((col) => ({
      categoryId: col.categoryId,
      name: col.name,
      cells: col.cells.map((c) => ({
        questionId: c.question.id,
        value: c.boardValue,
        used: c.used,
      })),
    }));
    return {
      type: 'board',
      phase: this.phase,
      board,
      currentClue: this.current
        ? clueView(this.current.cell.question, this.current.categoryName, this.current.cell.boardValue, role)
        : null,
      revealedAnswer: this.phase === 'answer-reveal' ? this.revealedAnswer : null,
      wrongAnswerPenalty: this.penalty,
    };
  }
}
