import { createHash } from 'node:crypto';

/** The pages' only styles: inline, so the pages need no other request. */
export const STYLES = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; display: grid; min-height: 100vh; place-items: center; }
main { width: min(100% - 32px, 360px); }
h1 { font-size: 1.5rem; }
form { display: grid; gap: 8px; }
input, button { font: inherit; padding: 10px; border-radius: 6px; }
input { border: 1px solid GrayText; }
button { margin-top: 8px; border: 0; background: #2f6f4f; color: white; cursor: pointer; }
.error { padding: 10px; border-radius: 6px; background: #fde8e8; color: #8a1c1c; }
`;

/**
 * The Content Security Policy allows exactly this stylesheet by its hash and no
 * scripts at all, so injected markup can't run code on the page that takes passwords.
 */
export const STYLES_HASH = `'sha256-${createHash('sha256').update(STYLES).digest('base64')}'`;
