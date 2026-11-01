import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordProblem,
} from '../account/password-policy';

/** What the registration and reset forms say about a rejected password */
export const PASSWORD_PROBLEMS: Record<PasswordProblem, string> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  breached:
    'This password has appeared in a data breach, so attackers try it first. Choose another one.',
};
