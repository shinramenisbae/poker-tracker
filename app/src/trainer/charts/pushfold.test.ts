import { describe, it, expect } from 'vitest';
import { pushFold, pushFoldKey, PUSH_FOLD_DEPTHS } from './pushfold';
import { expandNotation } from '../ranges';

describe('pushfold data', () => {
  it('has an entry for each authored position/depth and parses cleanly', () => {
    for (const key of Object.keys(pushFold)) {
      const set = expandNotation(pushFold[key]);
      expect(set.size).toBeGreaterThan(0);
      expect(set.has('AA')).toBe(true); // every jam range contains AA
    }
  });
  it('shorter stacks jam wider than deeper stacks (BTN)', () => {
    const wide = expandNotation(pushFold[pushFoldKey('BTN', 10)]).size;
    const tight = expandNotation(pushFold[pushFoldKey('BTN', 25)]).size;
    expect(wide).toBeGreaterThan(tight);
  });
  it('covers the four declared depths for BTN', () => {
    for (const d of PUSH_FOLD_DEPTHS) {
      expect(pushFold[pushFoldKey('BTN', d)]).toBeTruthy();
    }
  });
});
