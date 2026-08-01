import { describe, expect, it } from 'vitest';
import {
  MATCH_WINS,
  creatorSymbol,
  evaluateBoard,
  joinerSymbol,
  other,
} from './engine';

const X = 'X' as const;
const O = 'O' as const;

function board(cells: (typeof X | typeof O | null)[]): typeof cells {
  return cells;
}

describe('evaluateBoard', () => {
  it('returns the winner for a top row', () => {
    const b = board([X, X, X, O, O, null, null, null, null]);
    expect(evaluateBoard(b)).toEqual({ winner: X, line: [0, 1, 2] });
  });

  it('returns the winner for a column', () => {
    const b = board([O, X, null, O, X, null, O, null, null]);
    expect(evaluateBoard(b)).toEqual({ winner: O, line: [0, 3, 6] });
  });

  it('returns the winner for a diagonal', () => {
    const b = board([X, O, null, O, X, null, null, null, X]);
    expect(evaluateBoard(b)).toEqual({ winner: X, line: [0, 4, 8] });
  });

  it('returns draw for a full board with no winner', () => {
    const b = board([X, O, X, O, O, X, X, X, O]);
    expect(evaluateBoard(b).winner).toBe('draw');
  });

  it('returns null while the set is in progress', () => {
    const b = board([X, null, null, O, null, null, null, null, null]);
    expect(evaluateBoard(b).winner).toBeNull();
  });

  it('does not mistake a partial line for a win', () => {
    const b = board([X, X, null, null, null, null, null, null, null]);
    expect(evaluateBoard(b).winner).toBeNull();
  });
});

describe('other', () => {
  it('flips the player', () => {
    expect(other(X)).toBe(O);
    expect(other(O)).toBe(X);
  });
});

describe('alternating symbols (best of three)', () => {
  it('creator plays X on odd sets and O on even sets', () => {
    expect(creatorSymbol(1)).toBe(X);
    expect(creatorSymbol(2)).toBe(O);
    expect(creatorSymbol(3)).toBe(X);
  });

  it('joiner always takes the opposite symbol', () => {
    expect(joinerSymbol(1)).toBe(O);
    expect(joinerSymbol(2)).toBe(X);
    expect(joinerSymbol(3)).toBe(O);
  });
});

describe('match rules', () => {
  it('needs two set wins', () => {
    expect(MATCH_WINS).toBe(2);
  });
});
