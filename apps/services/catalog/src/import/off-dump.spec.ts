import { shouldParse } from './off-dump';

const known = new Set(['4000417025005']);

describe('shouldParse', () => {
  it('parses every product with a nutrition block, from any country', () => {
    expect(
      shouldParse(
        '{"code":"5411188110835","nutrition":{"aggregated_set":{"per":"100g"}}}',
        known,
      ),
    ).toBe(true);
  });

  it('parses known products, wherever their code key is', () => {
    // A nested object with its own "code" comes before the product's code
    expect(
      shouldParse(
        '{"packagings":[{"code":"18020"}],"code":"4000417025005"}',
        known,
      ),
    ).toBe(true);
  });

  it('skips unknown products without nutrition data', () => {
    expect(shouldParse('{"code":"3017620422003","nutrition":{}}', known)).toBe(
      false,
    );
  });
});
