import { pickName, preferredLanguages } from './display-name';

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

describe('pickName', () => {
  const names = { pl: 'Twaróg', en: 'Quark', ru: 'Творог' };

  it('uses the first requested language that has a name', () => {
    expect(pickName(names, ['ru', 'en'])).toBe('Творог');
    expect(pickName(names, ['de', 'en'])).toBe('Quark');
  });

  it('falls back to Polish, then English', () => {
    expect(pickName(names, ['de'])).toBe('Twaróg');
    expect(pickName({ en: 'Quark', fr: 'Fromage blanc' }, [])).toBe('Quark');
  });

  it('falls back to any name when neither exists', () => {
    expect(pickName({ fr: 'Fromage blanc' }, ['ru'])).toBe('Fromage blanc');
  });
});
