export type ChoreFrequency = 'daily' | 'weekly' | 'custom_days';

/** The parts of a chore that are worth describing in the activity log. */
export type ChoreSnapshot = {
  name: string;
  frequency: ChoreFrequency;
  customDays?: number[] | null;
  category?: string | null;
  rotation: string[];
};

const WEEKDAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// Mirrors the `details` ceiling in firestore.rules; a longer write is rejected.
const LOG_DETAILS_MAX = 200;

export function frequencyLabel(frequency: ChoreFrequency, customDays?: number[] | null): string {
  if (frequency === 'daily') return 'יומי';
  if (frequency === 'weekly') return 'שבועי';
  const days = [...(customDays || [])]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LETTERS[d])
    .filter(Boolean);
  return days.length ? `ימים: ${days.join(', ')}` : 'ימים ספציפיים';
}

export function clampDetails(text: string): string {
  return text.length <= LOG_DETAILS_MAX ? text : `${text.slice(0, LOG_DETAILS_MAX - 1)}…`;
}

/** Build a log line as "base · part · part", dropping empty parts and clamping. */
export function joinDetails(base: string, parts: (string | null | undefined)[]): string {
  const extras = parts.filter((p): p is string => !!p);
  return clampDetails(extras.length ? `${base} · ${extras.join(' · ')}` : base);
}

export function describeChoreChanges(
  before: ChoreSnapshot,
  after: ChoreSnapshot,
  nameOf: (userId: string) => string
): string[] {
  const changes: string[] = [];

  if (before.name !== after.name) changes.push(`שם: "${after.name}"`);

  const beforeFreq = frequencyLabel(before.frequency, before.customDays);
  const afterFreq = frequencyLabel(after.frequency, after.customDays);
  if (beforeFreq !== afterFreq) changes.push(`תדירות: ${afterFreq}`);

  const beforeCategory = before.category || '';
  const afterCategory = after.category || '';
  if (beforeCategory !== afterCategory) {
    changes.push(afterCategory ? `תחום: ${afterCategory}` : 'הוסר התחום');
  }

  const added = after.rotation.filter((id) => !before.rotation.includes(id));
  const removed = before.rotation.filter((id) => !after.rotation.includes(id));
  if (added.length) changes.push(`נוספו לסבב: ${added.map(nameOf).join(', ')}`);
  if (removed.length) changes.push(`הוסרו מהסבב: ${removed.map(nameOf).join(', ')}`);
  if (!added.length && !removed.length && before.rotation.join('|') !== after.rotation.join('|')) {
    changes.push('שונה סדר הסבב');
  }

  return changes;
}
