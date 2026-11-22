import { z } from 'zod';
import { uuidv7 } from './uuidv7';

describe('uuidv7', () => {
  it('makes version 7 UUIDs', () => {
    const id = uuidv7();
    expect(z.uuidv7().safeParse(id).success).toBe(true);
    expect(id).not.toBe(uuidv7());
  });

  it('starts with the time, so later ids sort later', () => {
    const time = Date.UTC(2026, 10, 22, 12, 0, 0, 123);
    const id = uuidv7(time);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(time);
    expect(uuidv7(time) < uuidv7(time + 1)).toBe(true);
  });
});
