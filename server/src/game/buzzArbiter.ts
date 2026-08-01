import type { BuzzEntry, BuzzResult, BuzzState } from '@trivia/shared';

/**
 * Authoritative buzz arbitration. Ordering is by server receive order —
 * Node's single-threaded event loop makes arrival order well-defined, and
 * device timestamps are never trusted (hardware clocks aren't synchronized).
 *
 * After the first accepted buzz the race is decided, but later buzzes are
 * still queued so the host can see the full buzz order.
 */
export class BuzzArbiter {
  private isOpen = false;
  private eligible = new Set<number>();
  private allTeamIds: number[] = [];
  private queue: BuzzEntry[] = [];
  private answeringTeamId: number | null = null;

  /** Start a fresh race among the given teams. */
  open(eligibleTeamIds: number[], allTeamIds: number[]): void {
    this.isOpen = true;
    this.eligible = new Set(eligibleTeamIds);
    this.allTeamIds = allTeamIds;
    this.queue = [];
    this.answeringTeamId = null;
  }

  /** Stop accepting buzzes but keep the queue visible (e.g. while judging). */
  close(): void {
    this.isOpen = false;
  }

  /** Clear everything (leaving a clue / after judging resolves). */
  reset(): void {
    this.isOpen = false;
    this.eligible.clear();
    this.queue = [];
    this.answeringTeamId = null;
  }

  /** Returns the buzz result plus whether this buzz won the race. */
  buzz(teamId: number): BuzzResult & { first: boolean } {
    if (!this.isOpen && this.answeringTeamId === null) {
      return { accepted: false, reason: 'not-open', first: false };
    }
    if (!this.eligible.has(teamId)) {
      return { accepted: false, reason: 'locked-out', first: false };
    }
    if (this.queue.some((e) => e.teamId === teamId)) {
      return { accepted: false, reason: 'duplicate', first: false };
    }
    const order = this.queue.length + 1;
    this.queue.push({ teamId, order });
    const first = order === 1;
    if (first) this.answeringTeamId = teamId;
    return { accepted: true, order, first };
  }

  hasActiveRace(): boolean {
    return this.isOpen || this.answeringTeamId !== null;
  }

  state(): BuzzState | null {
    if (!this.hasActiveRace() && this.queue.length === 0) return null;
    return {
      open: this.isOpen && this.answeringTeamId === null,
      queue: [...this.queue],
      lockedTeamIds: this.allTeamIds.filter((id) => !this.eligible.has(id)),
      answeringTeamId: this.answeringTeamId,
    };
  }
}
