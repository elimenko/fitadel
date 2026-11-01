import { alreadyRegisteredEmail, verificationEmail } from './emails';

describe('verificationEmail', () => {
  const link = 'http://localhost:3010/verify-email?token=abc';

  it('carries the link in both the text and the HTML', () => {
    const email = verificationEmail({ to: 'a@b.c', link });

    expect(email.to).toBe('a@b.c');
    expect(email.text).toContain(link);
    expect(email.html).toContain(`href="${link}"`);
  });

  it('escapes the name the user typed', () => {
    const email = verificationEmail({
      to: 'a@b.c',
      displayName: '<img src=x onerror=alert(1)>',
      link,
    });

    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img');
  });
});

describe('alreadyRegisteredEmail', () => {
  it('has no link that could finish a registration', () => {
    const email = alreadyRegisteredEmail({ to: 'a@b.c' });

    expect(email.text).not.toContain('http');
    expect(email.html).not.toContain('href');
  });
});
