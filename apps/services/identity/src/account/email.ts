/**
 * Emails are stored trimmed and lowercased (a CHECK in the migration enforces it), so
 * every lookup and insert goes through this first.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
