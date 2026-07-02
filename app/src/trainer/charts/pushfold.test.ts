import { describe, it, expect } from 'vitest';
import { pushFold, pushFoldKey, PUSH_FOLD_DEPTHS } from './pushfold';
import { expandNotation } from '../ranges';

// Hand-class counts per range, verified against the a1r93/push-or-fold source
// semantics during conversion (see source/NOTICE.md). Pins the data against
// accidental edits.
const EXPECTED_CLASS_COUNTS: Record<string, number> = {
  'UTG-5': 53, 'HJ-5': 58, 'CO-5': 65, 'BTN-5': 75, 'SB-5': 133,
  'UTG-10': 36, 'HJ-10': 45, 'CO-10': 56, 'BTN-10': 63, 'SB-10': 109,
  'UTG-15': 26, 'HJ-15': 34, 'CO-15': 41, 'BTN-15': 61, 'SB-15': 91,
  'UTG-20': 15, 'HJ-20': 23, 'CO-20': 31, 'BTN-20': 49, 'SB-20': 83,
};

const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const;

describe('pushfold data', () => {
  it('has an entry for each authored position/depth and parses cleanly', () => {
    for (const key of Object.keys(pushFold)) {
      const set = expandNotation(pushFold[key]);
      expect(set.size).toBeGreaterThan(0);
      expect(set.has('AA')).toBe(true); // every jam range contains AA
    }
  });

  it('every position/depth combination is present with the verified class count', () => {
    expect(Object.keys(pushFold).sort()).toEqual(Object.keys(EXPECTED_CLASS_COUNTS).sort());
    for (const [key, count] of Object.entries(EXPECTED_CLASS_COUNTS)) {
      expect(expandNotation(pushFold[key]).size, key).toBe(count);
    }
  });

  it('shorter stacks jam wider than deeper stacks (every position)', () => {
    for (const pos of POSITIONS) {
      const sizes = PUSH_FOLD_DEPTHS.map((d) => expandNotation(pushFold[pushFoldKey(pos, d)]).size);
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i], `${pos} ${PUSH_FOLD_DEPTHS[i]}bb vs ${PUSH_FOLD_DEPTHS[i - 1]}bb`).toBeLessThan(sizes[i - 1]);
      }
    }
  });

  it('later positions jam wider than earlier positions (every depth)', () => {
    for (const d of PUSH_FOLD_DEPTHS) {
      const sizes = POSITIONS.map((p) => expandNotation(pushFold[pushFoldKey(p, d)]).size);
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i], `${POSITIONS[i]} vs ${POSITIONS[i - 1]} at ${d}bb`).toBeGreaterThan(sizes[i - 1]);
      }
    }
  });

  it('spot-checks known chart values', () => {
    // UTG 20bb is tight: TT+ jams, 99 does not
    const utg20 = expandNotation(pushFold['UTG-20']);
    expect(utg20.has('TT')).toBe(true);
    expect(utg20.has('99')).toBe(false);
    expect(utg20.has('72o')).toBe(false);
    // SB 5bb is near any-two: even Q2o jams
    const sb5 = expandNotation(pushFold['SB-5']);
    expect(sb5.has('Q2o')).toBe(true);
    // BTN 10bb jams any ace; UTG 10bb does not
    expect(expandNotation(pushFold['BTN-10']).has('A2o')).toBe(true);
    expect(expandNotation(pushFold['UTG-10']).has('A2o')).toBe(false);
  });

  it('covers the four declared depths for BTN', () => {
    for (const d of PUSH_FOLD_DEPTHS) {
      expect(pushFold[pushFoldKey('BTN', d)]).toBeTruthy();
    }
  });
});
