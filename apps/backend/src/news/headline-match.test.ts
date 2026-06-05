import { describe, it, expect } from 'vitest';
import { headlineMatchesSymbol } from './headline-match.js';

describe('headlineMatchesSymbol', () => {
  it('matches when the ticker symbol appears', () => {
    expect(headlineMatchesSymbol('PAM stock jumps on earnings', 'PAM')).toBe(true);
  });
  it('matches via a company-name alias', () => {
    expect(headlineMatchesSymbol('Pampa Energía soars 8%', 'PAM', ['Pampa Energía', 'Pampa'])).toBe(true);
  });
  it('rejects a Pampa headline attached to HSBC (names a competitor)', () => {
    expect(headlineMatchesSymbol('Pampa Energía soars 8%', 'HSBC', ['HSBC Holdings', 'HSBC'], ['Pampa Energía'])).toBe(false);
  });
  it("drops a YPF headline misattributed to BP even when it is BP's only news", () => {
    expect(headlineMatchesSymbol('YPF Sociedad Anonima - 15 Year History | YPF', 'BP', ['BP plc', 'BP'], ['YPF'])).toBe(false);
  });
  it('keeps real-but-unnamed news (no competitor named) so it is not lost', () => {
    expect(headlineMatchesSymbol('Oil giant beats earnings, raises dividend', 'BP', ['BP plc', 'BP'], ['YPF', 'Pampa Energía'])).toBe(true);
  });
  it('is permissive when nothing is known and no competitor is named', () => {
    expect(headlineMatchesSymbol('Markets rally on rate cut hopes', 'XYZ')).toBe(true);
  });
  it('uses word boundaries and drops a clearly-named competitor', () => {
    // PAM must NOT match as a substring of "Spammers"/"Pampa"; the headline names Pampa Energía → drop.
    expect(headlineMatchesSymbol('Spammers target Pampa Energía investors', 'PAM', [], ['Pampa Energía'])).toBe(false);
  });
  it('empty headline is permissive', () => {
    expect(headlineMatchesSymbol('', 'PAM')).toBe(true);
  });
});
