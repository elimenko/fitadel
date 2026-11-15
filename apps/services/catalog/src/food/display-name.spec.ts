import { pickName } from './display-name';

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
