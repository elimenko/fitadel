import { createHash } from 'node:crypto';
import { PwnedPasswords } from './pwned-passwords';

describe('PwnedPasswords', () => {
  const client = new PwnedPasswords({
    baseUrl: 'https://hibp.test',
    userAgent: 'Fitadel/test',
    timeoutMs: 1000,
  });
  const sha1 = createHash('sha1').update('hunter2').digest('hex').toUpperCase();
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  const answer = (body: string, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));

  afterAll(() => fetchMock.mockRestore());

  it('sends only the first 5 characters of the hash, with padding', async () => {
    answer('');

    await client.isBreached('hunter2');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://hibp.test/range/${sha1.slice(0, 5)}`);
    expect(String(url)).not.toContain(sha1.slice(5));
    expect(init?.headers).toMatchObject({ 'Add-Padding': 'true' });
  });

  it('finds a breached password among the returned suffixes', async () => {
    answer(
      `0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${sha1.slice(5)}:52579\r\n`,
    );

    expect(await client.isBreached('hunter2')).toBe(true);
  });

  it('ignores padding entries, which have a count of 0', async () => {
    answer(`${sha1.slice(5)}:0\r\n`);

    expect(await client.isBreached('hunter2')).toBe(false);
  });

  it('throws when the API fails, since that says nothing about the password', async () => {
    answer('', 503);

    await expect(client.isBreached('hunter2')).rejects.toThrow(/503/);
  });
});
