/** Lightweight, client-only "reminder" helpers.
 *
 * This intentionally does NOT implement server-sent push (Firebase Cloud
 * Messaging with a backend trigger) — that requires provisioning a Cloud
 * Function or scheduled job on the Firebase project and a VAPID key, which
 * has to be set up and deployed against the actual project outside of this
 * codebase. What's implemented here is the achievable client-side piece:
 * requesting Notification permission and showing a local reminder (via the
 * browser's Notification API / the installed PWA's service worker) when the
 * signed-in resident has an undone chore today. It only fires while the
 * device has the app open/installed, not a true background push.
 */

const REMINDER_TOGGLE_KEY = 'chores_reminders_enabled';
const REMINDER_SHOWN_KEY_PREFIX = 'chores_reminder_shown_';

export function remindersSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function remindersEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(REMINDER_TOGGLE_KEY) === '1' && Notification.permission === 'granted';
}

export async function enableReminders(): Promise<boolean> {
  if (!remindersSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  localStorage.setItem(REMINDER_TOGGLE_KEY, '1');
  return true;
}

export function disableReminders() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REMINDER_TOGGLE_KEY, '0');
}

/** Show a "it's your turn" reminder at most once per resident per day. */
export async function maybeShowTurnReminder(dateKey: string, userId: string, choreNames: string[]) {
  if (!remindersEnabled() || choreNames.length === 0) return;
  const key = `${REMINDER_SHOWN_KEY_PREFIX}${userId}_${dateKey}`;
  if (localStorage.getItem(key) === '1') return;

  const title = 'תורנויות הבית';
  const body =
    choreNames.length === 1
      ? `היום התור שלך ב: ${choreNames[0]}`
      : `היום התור שלך ב-${choreNames.length} משימות: ${choreNames.join(', ')}`;

  // The "already shown today" flag is only set once a notification actually
  // appeared; setting it up front turned a single failure into a silent day.
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, { body, icon: '/icons/icon-192.png' });
        localStorage.setItem(key, '1');
        return;
      }
    }
    new Notification(title, { body, icon: '/icons/icon-192.png' });
    localStorage.setItem(key, '1');
  } catch (err) {
    console.error('[reminders] failed to show notification:', err);
  }
}
