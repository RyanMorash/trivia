import type {
  Command,
  Question,
  Role,
  WagerPhase,
  WagerRevealStage,
  WagerRoundConfig,
  WagerRoundState,
  WagerTeamView,
} from '@trivia/shared';
import type { ContentRepo } from '../../db/repos/contentRepo.js';
import { clueView } from './judgingBase.js';
import { CommandError, type Actor, type EngineCtx, type RoundHandler } from './RoundType.js';

interface WagerEntry {
  teamId: number;
  wager: number;
  wagerSubmitted: boolean;
  answer: string;
  answerSubmitted: boolean;
  judged: 'correct' | 'incorrect' | null;
  revealStage: WagerRevealStage;
  scoreApplied: boolean;
  maxWager: number;
}

/**
 * Final-Jeopardy-style round: teams see a topic, wager privately, then the
 * clue is shown, answers are typed on team tablets (or entered by staff),
 * and the host steps through a per-team staged reveal:
 * answer-shown -> judged -> wager-shown (score applied).
 */
export class WagerRound implements RoundHandler {
  readonly type = 'wager';
  private phase: WagerPhase = 'round-intro';
  private question: Question | null = null;
  private topic = '';
  private entries = new Map<number, WagerEntry>();
  private currentRevealTeamId: number | null = null;
  private config: WagerRoundConfig;

  constructor(config: WagerRoundConfig, content: ContentRepo) {
    this.config = config;
    this.question = content.getQuestion(config.questionId);
    if (this.question) {
      const category = content.getCategory(this.question.categoryId);
      this.topic = category?.name ?? '';
    }
  }

  private entry(teamId: number): WagerEntry {
    const e = this.entries.get(teamId);
    if (!e) throw new CommandError('Team is not part of this round');
    return e;
  }

  private maxWagerFor(score: number): number {
    if (this.config.maxWagerRule === 'cap') return this.config.cap ?? 0;
    return Math.max(score, 0);
  }

  handleCommand(cmd: Command, actor: Actor, ctx: EngineCtx): void {
    switch (cmd.type) {
      case 'continue':
        this.handleContinue(ctx);
        break;

      case 'submitWager': {
        if (this.phase !== 'wager-collect') throw new CommandError('Wagers are not open');
        if (actor.teamId === undefined) throw new CommandError('Not a team device');
        this.setWager(actor.teamId, cmd.amount, true);
        break;
      }
      case 'setWager':
        if (this.phase !== 'wager-collect') throw new CommandError('Wagers are not open');
        this.setWager(cmd.teamId, cmd.amount, true);
        break;

      case 'lockWagers':
      case 'showWagerClue':
        if (this.phase !== 'wager-collect') throw new CommandError('Wagers are not being collected');
        this.phase = 'clue-shown';
        break;

      case 'submitAnswer': {
        if (!['clue-shown', 'answer-collect'].includes(this.phase)) {
          throw new CommandError('Answers are not open');
        }
        if (actor.teamId === undefined) throw new CommandError('Not a team device');
        const e = this.entry(actor.teamId);
        e.answer = cmd.text.slice(0, 300);
        e.answerSubmitted = true;
        break;
      }
      case 'setAnswer': {
        if (!['clue-shown', 'answer-collect', 'reveal'].includes(this.phase)) {
          throw new CommandError('Answers are not open');
        }
        const e = this.entry(cmd.teamId);
        e.answer = cmd.text.slice(0, 300);
        e.answerSubmitted = true;
        break;
      }

      case 'lockAnswers':
        if (this.phase !== 'answer-collect') throw new CommandError('Answers are not being collected');
        this.phase = 'reveal';
        this.currentRevealTeamId = null;
        break;

      case 'revealTeam': {
        if (this.phase !== 'reveal') throw new CommandError('Not in the reveal phase');
        const e = this.entry(cmd.teamId);
        this.currentRevealTeamId = cmd.teamId;
        if (e.revealStage === 'hidden') e.revealStage = 'answer-shown';
        break;
      }

      case 'judgeWager': {
        if (this.phase !== 'reveal') throw new CommandError('Not in the reveal phase');
        const e = this.entry(cmd.teamId);
        if (e.revealStage === 'hidden') e.revealStage = 'answer-shown';
        e.judged = cmd.correct ? 'correct' : 'incorrect';
        if (e.revealStage === 'answer-shown') e.revealStage = 'judged';
        break;
      }

      case 'revealStep': {
        if (this.phase !== 'reveal') throw new CommandError('Not in the reveal phase');
        if (this.currentRevealTeamId === null) throw new CommandError('No team selected for reveal');
        const e = this.entry(this.currentRevealTeamId);
        if (e.revealStage === 'answer-shown') {
          throw new CommandError('Judge the answer before revealing the wager');
        }
        if (e.revealStage !== 'judged') throw new CommandError('Nothing further to reveal');
        e.revealStage = 'wager-shown';
        if (!e.scoreApplied && this.question) {
          const delta = e.judged === 'correct' ? e.wager : -e.wager;
          if (delta !== 0) {
            ctx.addScore(e.teamId, delta, e.judged === 'correct' ? 'wager-correct' : 'wager-incorrect', this.question.id);
          }
          e.scoreApplied = true;
        }
        break;
      }

      case 'clearLockouts':
        break; // no lockouts in a wager round

      default:
        throw new CommandError(`Command ${cmd.type} not valid in a wager round`);
    }
  }

  private handleContinue(ctx: EngineCtx): void {
    switch (this.phase) {
      case 'round-intro': {
        this.phase = 'wager-collect';
        this.entries.clear();
        for (const teamId of ctx.activeTeamIds()) {
          this.entries.set(teamId, {
            teamId,
            wager: 0,
            wagerSubmitted: false,
            answer: '',
            answerSubmitted: false,
            judged: null,
            revealStage: 'hidden',
            scoreApplied: false,
            maxWager: this.maxWagerFor(ctx.teamScore(teamId)),
          });
        }
        break;
      }
      case 'clue-shown':
        this.phase = 'answer-collect';
        break;
      case 'reveal': {
        const pending = [...this.entries.values()].some((e) => e.revealStage !== 'wager-shown');
        if (pending) throw new CommandError('Reveal every team before finishing the round');
        this.phase = 'round-complete';
        break;
      }
      default:
        throw new CommandError('Nothing to continue from');
    }
  }

  private setWager(teamId: number, amount: number, submitted: boolean): void {
    const e = this.entry(teamId);
    if (!Number.isFinite(amount)) throw new CommandError('Invalid wager');
    e.wager = Math.max(0, Math.min(Math.floor(amount), e.maxWager));
    e.wagerSubmitted = submitted;
  }

  onFirstBuzz(): void {
    // No buzzing in a wager round.
  }

  isComplete(): boolean {
    return this.phase === 'round-complete';
  }

  view(role: Role, viewerTeamId?: number): WagerRoundState {
    const staff = role === 'showrunner' || role === 'host';
    const clueVisible = this.phase !== 'round-intro' && this.phase !== 'wager-collect';
    const teams: WagerTeamView[] = [...this.entries.values()].map((e) => {
      const own = role === 'competitor' && viewerTeamId === e.teamId;
      const wagerVisible = staff || own || e.revealStage === 'wager-shown';
      const answerVisible = staff || own || e.revealStage !== 'hidden';
      return {
        teamId: e.teamId,
        wagerSubmitted: e.wagerSubmitted,
        wager: wagerVisible ? e.wager : null,
        answerSubmitted: e.answerSubmitted,
        answer: answerVisible ? e.answer : null,
        judged: staff || e.revealStage === 'judged' || e.revealStage === 'wager-shown' ? e.judged : null,
        revealStage: e.revealStage,
        maxWager: e.maxWager,
      };
    });
    return {
      type: 'wager',
      phase: this.phase,
      topic: this.topic,
      clue: this.question && clueVisible ? clueView(this.question, this.topic, 0, role) : null,
      teams,
      currentRevealTeamId: this.currentRevealTeamId,
    };
  }
}
