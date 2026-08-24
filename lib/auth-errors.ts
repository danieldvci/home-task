/** Turns a Firebase auth error into something worth telling the user, or nothing. */

/**
 * Codes that mean the person changed their mind rather than something failing.
 *
 * `cancelled-popup-request` is the odd one: Firebase rejects a pending popup
 * when a second one opens, which in practice is a double-clicked login button.
 * The later popup still signs the user in, so reporting the first as a failure
 * would contradict what is about to happen on screen.
 */
const SILENT_CODES = [
  'auth/cancelled-popup-request',
  'auth/popup-closed-by-user',
  'auth/user-cancelled'
];

const MESSAGES: Record<string, string> = {
  'auth/popup-blocked': 'הדפדפן חסם את חלון ההתחברות. יש לאפשר חלונות קופצים ולנסות שוב.',
  'auth/unauthorized-domain': 'הכתובת הזו אינה מאושרת להתחברות. יש להוסיף אותה לדומיינים המאושרים ב-Firebase.',
  'auth/network-request-failed': 'אין חיבור לרשת. בדוק את החיבור ונסה שוב.'
};

const GENERIC = 'ההתחברות נכשלה. נסה שוב.';

const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';

/** Message to show, or null when the error should pass without a word. */
export function describeAuthError(error: unknown): string | null {
  const code = codeOf(error);
  if (SILENT_CODES.includes(code)) return null;
  return MESSAGES[code] ?? GENERIC;
}
