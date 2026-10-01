/**
 * The icon a chore or a resident is drawn with, as a stored name.
 *
 * A document keeps a short id, never a component: the value round-trips
 * through Firestore, and the security rules can only check a string. The names
 * become icons in `components/default-icons.tsx`, which is the same split as
 * `statePresentation` and `components/state-icons.ts` and exists for the same
 * reason - this module has to keep running under `tsx` in the test suite.
 *
 * Every read resolves through the functions below rather than reading the
 * field, because three cases have to look identical to whatever draws them: a
 * document written before the field existed, one written by a later build with
 * a name this one does not know, and one a user actually chose. The first two
 * fall back to a name derived from the document itself, so the icon a chore
 * gets is stable across devices and across reloads without anything being
 * written to make it so.
 */

export const CHORE_ICON_IDS = [
  'dishes',
  'trash',
  'laundry',
  'clothes',
  'bathroom',
  'cooking',
  'fridge',
  'sweep',
  'tidy',
  'bed',
  'pets',
  'plants',
  'shopping',
  'car',
  'living',
  'task'
] as const;

export type ChoreIconId = (typeof CHORE_ICON_IDS)[number];

/** Used when nothing about a chore suggests anything better. */
export const DEFAULT_CHORE_ICON: ChoreIconId = 'task';

export const USER_ICON_IDS = [
  'smile',
  'star',
  'heart',
  'crown',
  'rocket',
  'cat',
  'dog',
  'rabbit',
  'bird',
  'fish',
  'flower',
  'sun',
  'moon',
  'leaf',
  'music',
  'game',
  'iceCream',
  'ghost'
] as const;

export type UserIconId = (typeof USER_ICON_IDS)[number];

/** Mirrors the ceiling the security rules put on the stored field. */
export const ICON_ID_MAX_LENGTH = 24;

export const isChoreIconId = (value: unknown): value is ChoreIconId =>
  typeof value === 'string' && (CHORE_ICON_IDS as readonly string[]).includes(value);

export const isUserIconId = (value: unknown): value is UserIconId =>
  typeof value === 'string' && (USER_ICON_IDS as readonly string[]).includes(value);

// Same shape as the hash in lib/household-utils: small, stable, and the same
// answer on every device, which is the only property that matters here.
const hashString = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * What a chore is called usually says what it is, so a household that never
 * opens the picker still gets plates on the washing-up rather than sixteen
 * copies of the same generic tick.
 *
 * Matched on a substring because Hebrew inflects and prefixes freely: "כביסה",
 * "הכביסה" and "לתלות כביסה" are all the same chore.
 */
const NAME_HINTS: ReadonlyArray<readonly [ChoreIconId, readonly string[]]> = [
  ['dishes', ['כלים', 'מדיח', 'כיור', 'dish']],
  ['trash', ['זבל', 'אשפה', 'פח', 'מיחזור', 'trash']],
  ['laundry', ['כביסה', 'מכונה', 'laundry']],
  ['clothes', ['בגדים', 'קיפול', 'גיהוץ', 'גרביים']],
  ['bathroom', ['אמבט', 'מקלחת', 'שירותים', 'אסלה']],
  ['cooking', ['בישול', 'ארוחה', 'אוכל', 'לבשל', 'סנדוויץ']],
  ['fridge', ['מקרר', 'מזווה']],
  ['sweep', ['רצפ', 'שאיבת', 'אבק', 'טאטוא', 'ספונג', 'ניקיון', 'לנקות']],
  ['tidy', ['סידור', 'לסדר', 'שולחן', 'מטבח']],
  ['bed', ['מיטה', 'מיטות', 'חדר', 'סדינים']],
  ['pets', ['כלב', 'חתול', 'חיות', 'אקווריום', 'לטייל']],
  ['plants', ['צמח', 'גינה', 'השקי', 'פרח', 'דשא']],
  ['shopping', ['קניות', 'סופר', 'מכולת']],
  ['car', ['רכב', 'אוטו', 'מכונית']],
  ['living', ['סלון', 'מרפסת']]
];

/** A stable icon for a chore that has never been given one. */
export const fallbackChoreIcon = (name: string): ChoreIconId => {
  const haystack = name.trim();
  if (haystack.length === 0) return DEFAULT_CHORE_ICON;
  for (const [icon, hints] of NAME_HINTS) {
    if (hints.some(hint => haystack.includes(hint))) return icon;
  }
  return DEFAULT_CHORE_ICON;
};

/** The icon a chore is drawn with: what it stores, or what its name suggests. */
export const choreIconId = (chore: { name?: string; icon?: string | null }): ChoreIconId =>
  isChoreIconId(chore.icon) ? chore.icon : fallbackChoreIcon(chore.name ?? '');

/**
 * A resident's icon falls back to their id rather than their name, so renaming
 * somebody does not hand them a different face.
 */
export const fallbackUserIcon = (seed: string): UserIconId =>
  USER_ICON_IDS[hashString(seed) % USER_ICON_IDS.length];

export const userIconId = (user: { id?: string; icon?: string | null }): UserIconId =>
  isUserIconId(user.icon) ? user.icon : fallbackUserIcon(user.id ?? '');
