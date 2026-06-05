import { describe, it, expect } from 'vitest';
import { headlineMatchesSymbol } from './headline-match.js';

describe('headlineMatchesSymbol', () => {
  it('matches when the ticker symbol appears', () => {
    expect(headlineMatchesSymbol('PAM stock jumps on earnings', 'PAM')).toBe(true);
  });
  it('matches via a company-name alias', () => {
    expect(headlineMatchesSymbol('Pampa Energía soars 8%', 'PAM', ['Pampa Energía', 'Pampa'])).toBe(true);
  });
  it('rejects a Pampa headline attached to HSBC (the original bug)', () => {
    expect(headlineMatchesSymbol('Pampa Energía soars 8%', 'HSBC', ['HSBC Holdings', 'HSBC'])).toBe(false);
  });
  it('is permissive when no aliases are known and no competitor is named', () => {
    expect(headlineMatchesSymbol('Markets rally on rate cut hopes', 'XYZ')).toBe(true);
  });
  it('rejects when no aliases known but a competitor company is clearly named', () => {
    expect(headlineMatchesSymbol('Pampa Energía soars 8%', 'HSBC', [], ['Pampa Energía'])).toBe(false);
  });
  it('does not partial-match the symbol inside another word (PAM in PAMPLONA)', () => {
    // With aliases present, a non-boundary substring must NOT count as a match → rejected.
    expect(headlineMatchesSymbol('PAMPLONA festival opens', 'PAM', ['Pampa SA'])).toBe(false);
  });
  it('empty headline is permissive', () => {
    expect(headlineMatchesSymbol('', 'PAM')).toBe(true);
  });
});
