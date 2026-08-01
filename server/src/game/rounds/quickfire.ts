import type {
  Command,
  Question,
  QuickfireRoundConfig,
  QuickfireRoundState,
  Role,
} from '@trivia/shared';
import type { ContentRepo } from '../../db/repos/contentRepo.js';
import { clueView, JudgingRoundBase } from './judgingBase.js';
import { CommandError, type Actor, type EngineCtx, type RoundHandler } from './RoundType.js';

interface QuickfireQuestion {
  question: Question;
  categoryName: string;
}

export class QuickfireRound extends JudgingRoundBase implements RoundHandler {
  readonly type = 'quickfire';
  private questions: QuickfireQuestion[] = [];
  private index = -1;
  private points: number;
  private penalty: number;

  constructor(config: QuickfireRoundConfig, content: ContentRepo) {
    super();
    this.points = config.pointsPerQuestion;
    this.penalty = config.wrongAnswerPenalty;
    for (const categoryId of config.categoryIds) {
      const category = content.getCategory(categoryId);
      if (!category) continue;
      for (const question of content.listQuestions(categoryId)) {
        this.questions.push({ question, categoryName: category.name });
      }
    }
  }

  protected currentQuestion(): Question | null {
    return this.questions[this.index]?.question ?? null;
  }
  protected currentValue(): number {
    return this.points;
  }
  protected penaltyValue(): number {
    return this.penalty;
  }
  protected consumeCurrent(): void {
    // Sequential round — advancing the index is the consumption.
  }

  private advance(): void {
    if (this.index + 1 >= this.questions.length) {
      this.phase = 'round-complete';
      return;
    }
    this.index += 1;
    this.startClue();
  }

  handleCommand(cmd: Command, _actor: Actor, ctx: EngineCtx): void {
    switch (cmd.type) {
      case 'continue':
      case 'nextQuestion':
        if (!['round-intro', 'idle', 'answer-reveal'].includes(this.phase)) {
          throw new CommandError('Finish the current question first');
        }
        this.advance();
        break;
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
        throw new CommandError(`Command ${cmd.type} not valid in a quickfire round`);
    }
  }

  isComplete(): boolean {
    return this.phase === 'round-complete';
  }

  view(role: Role): QuickfireRoundState {
    const current = this.questions[this.index] ?? null;
    return {
      type: 'quickfire',
      phase: this.phase,
      questionIndex: this.index,
      totalQuestions: this.questions.length,
      currentClue:
        current && this.phase !== 'round-intro' && this.phase !== 'round-complete'
          ? clueView(current.question, current.categoryName, this.points, role)
          : null,
      revealedAnswer: this.phase === 'answer-reveal' ? this.revealedAnswer : null,
      pointsPerQuestion: this.points,
      wrongAnswerPenalty: this.penalty,
    };
  }
}
