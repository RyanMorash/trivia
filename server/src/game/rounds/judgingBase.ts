import type { ClueView, JudgingPhase, Question, Role } from '@trivia/shared';
import { CommandError, type EngineCtx } from './RoundType.js';

const STAFF: Role[] = ['showrunner', 'host'];

export function clueView(
  q: Question,
  categoryName: string,
  value: number,
  role: Role,
): ClueView {
  const staff = STAFF.includes(role);
  return {
    questionId: q.id,
    categoryName,
    prompt: q.prompt,
    value,
    answer: staff ? q.answer : null,
    notes: staff ? q.notes : null,
  };
}

/**
 * Shared buzz-and-judge loop used by board and quickfire rounds:
 * clue-shown -> buzzing-open -> judging -> (wrong: reopen race for remaining
 * teams) -> answer-reveal. Wrong-answer teams are locked out for the rest of
 * the clue; the reopen is a fresh race (fairer than promoting queue position 2,
 * which buzzed before hearing the wrong answer).
 */
export abstract class JudgingRoundBase {
  phase: JudgingPhase = 'round-intro';
  protected clueLockouts = new Set<number>();
  protected revealedAnswer: string | null = null;

  protected abstract currentQuestion(): Question | null;
  protected abstract currentValue(): number;
  protected abstract penaltyValue(): number;
  /** Mark the current clue consumed and return whether the round is exhausted. */
  protected abstract consumeCurrent(): void;

  protected eligibleTeams(ctx: EngineCtx): number[] {
    return ctx.activeTeamIds().filter((id) => !this.clueLockouts.has(id));
  }

  protected startClue(): void {
    this.clueLockouts.clear();
    this.revealedAnswer = null;
    this.phase = 'clue-shown';
  }

  openBuzzers(ctx: EngineCtx): void {
    if (this.phase !== 'clue-shown') throw new CommandError('No clue is being read');
    const eligible = this.eligibleTeams(ctx);
    if (eligible.length === 0) throw new CommandError('No eligible teams to buzz');
    this.phase = 'buzzing-open';
    ctx.openBuzzers(eligible);
  }

  closeBuzzers(ctx: EngineCtx): void {
    if (this.phase !== 'buzzing-open') throw new CommandError('Buzzers are not open');
    this.phase = 'clue-shown';
    ctx.resetBuzz();
  }

  onFirstBuzz(_teamId: number, _ctx: EngineCtx): void {
    if (this.phase === 'buzzing-open') this.phase = 'judging';
  }

  judge(correct: boolean, answeringTeamId: number | null, ctx: EngineCtx): void {
    if (this.phase !== 'judging') throw new CommandError('No answer is being judged');
    const q = this.currentQuestion();
    if (!q || answeringTeamId === null) throw new CommandError('No answering team');
    if (correct) {
      ctx.addScore(answeringTeamId, this.currentValue(), 'correct', q.id);
      this.reveal(ctx);
    } else {
      const penalty = this.penaltyValue();
      if (penalty > 0) ctx.addScore(answeringTeamId, -penalty, 'incorrect', q.id);
      this.clueLockouts.add(answeringTeamId);
      const eligible = this.eligibleTeams(ctx);
      if (eligible.length > 0) {
        this.phase = 'buzzing-open';
        ctx.openBuzzers(eligible);
      } else {
        this.reveal(ctx);
      }
    }
  }

  markDead(ctx: EngineCtx): void {
    if (!['clue-shown', 'buzzing-open', 'judging'].includes(this.phase)) {
      throw new CommandError('No live clue to mark dead');
    }
    this.reveal(ctx);
  }

  protected reveal(ctx: EngineCtx): void {
    const q = this.currentQuestion();
    this.revealedAnswer = q ? q.answer : null;
    this.consumeCurrent();
    this.phase = 'answer-reveal';
    ctx.resetBuzz();
  }

  clearLockouts(ctx: EngineCtx): void {
    this.clueLockouts.clear();
    if (this.phase === 'buzzing-open') {
      ctx.openBuzzers(this.eligibleTeams(ctx));
    }
  }
}
