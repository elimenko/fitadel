import { preferredLanguages } from './languages';

describe('preferredLanguages', () => {
  it('orders languages by quality and keeps primary subtags', () => {
    expect(preferredLanguages('ru-RU,ru;q=0.9,en;q=0.8')).toEqual(['ru', 'en']);
    expect(preferredLanguages('en;q=0.5, pl')).toEqual(['pl', 'en']);
  });

  it('ignores wildcards, refused languages and junk', () => {
    expect(preferredLanguages('*, de;q=0, 123, fr;q=0.7')).toEqual(['fr']);
    expect(preferredLanguages(undefined)).toEqual([]);
  });
});
