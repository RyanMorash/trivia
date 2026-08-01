import { describe, expect, it } from 'vitest';
import { BuzzArbiter } from '../src/game/buzzArbiter.js';

const TEAMS = [1, 2, 3, 4];

describe('BuzzArbiter', () => {
  it('rejects buzzes before a race opens', () => {
    const a = new BuzzArbiter();
    expect(a.buzz(1)).toMatchObject({ accepted: false, reason: 'not-open' });
  });

  it('orders buzzes by arrival and flags the winner', () => {
    const a = new BuzzArbiter();
    a.open(TEAMS, TEAMS);
    expect(a.buzz(3)).toMatchObject({ accepted: true, order: 1, first: true });
    expect(a.buzz(1)).toMatchObject({ accepted: true, order: 2, first: false });
    expect(a.state()).toMatchObject({ answeringTeamId: 3, open: false });
    expect(a.state()!.queue.map((e) => e.teamId)).toEqual([3, 1]);
  });

  it('rejects duplicates and ineligible teams', () => {
    const a = new BuzzArbiter();
    a.open([1, 2], TEAMS);
    expect(a.buzz(3)).toMatchObject({ accepted: false, reason: 'locked-out' });
    expect(a.buzz(1).accepted).toBe(true);
    expect(a.buzz(1)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(a.state()!.lockedTeamIds.sort()).toEqual([3, 4]);
  });

  it('reopen is a fresh race', () => {
    const a = new BuzzArbiter();
    a.open(TEAMS, TEAMS);
    a.buzz(1);
    a.open([2, 3, 4], TEAMS); // team 1 answered wrong, race reopens
    expect(a.state()!.queue).toEqual([]);
    expect(a.buzz(1)).toMatchObject({ accepted: false, reason: 'locked-out' });
    expect(a.buzz(4)).toMatchObject({ accepted: true, first: true });
  });

  it('close() before any buzz yields no active race', () => {
    const a = new BuzzArbiter();
    a.open(TEAMS, TEAMS);
    a.close();
    expect(a.buzz(1)).toMatchObject({ accepted: false, reason: 'not-open' });
  });

  it('handles a synthetic 1000-buzz race with one winner', () => {
    const a = new BuzzArbiter();
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    a.open(ids, ids);
    let firsts = 0;
    for (const id of ids) {
      const res = a.buzz(id);
      expect(res.accepted).toBe(true);
      if (res.first) firsts += 1;
    }
    expect(firsts).toBe(1);
    expect(a.state()!.answeringTeamId).toBe(1);
    expect(a.state()!.queue).toHaveLength(1000);
  });
});
