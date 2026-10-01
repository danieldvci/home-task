/** Pure helpers for household identity and display (testable without Firebase). */

export type HouseholdDoc = {
  id: string;
  ownerId: string;
  members: string[];
  name?: string;
  /**
   * Accounts the owner has handed the day-to-day admin to. Absent on every
   * household written before co-managers existed, which reads as "nobody but
   * the owner" - the behaviour those households already had.
   */
  managerIds?: string[];
  /**
   * `false` while the first-run wizard still owes this household its residents
   * and its chores. Absent means a household that predates the wizard, and
   * those must never be sent back through it, which is why the check below
   * asks for `false` rather than for anything falsy.
   */
  setupComplete?: boolean;
};

/**
 * The owner is the only account that can hand out or take back the role, so
 * the two questions are asked separately everywhere.
 */
export const isHouseholdOwner = (
  household: Pick<HouseholdDoc, 'ownerId'> | null | undefined,
  uid: string | null | undefined
): boolean => !!household && !!uid && household.ownerId === uid;

/** Owner, or an account the owner promoted. */
export const isHouseholdManager = (
  household: Pick<HouseholdDoc, 'ownerId' | 'managerIds'> | null | undefined,
  uid: string | null | undefined
): boolean =>
  isHouseholdOwner(household, uid) ||
  (!!household && !!uid && (household.managerIds ?? []).includes(uid));

/** A household still waiting to be set up. See `setupComplete` above. */
export const householdNeedsSetup = (
  household: Pick<HouseholdDoc, 'setupComplete'> | null | undefined
): boolean => household?.setupComplete === false;

/**
 * Resident colours. One list, because three copies of it had already drifted
 * apart: a Google profile, a local resident added in settings and a resident
 * added by the wizard all draw from this.
 */
export const PROFILE_COLORS = [
  'bg-[#A1C181]',
  'bg-[#D4CBBF]',
  'bg-[#8C7E6A]',
  'bg-[#B99543]',
  'bg-[#E5989B]',
  'bg-[#81B29A]',
  'bg-[#E07A5F]',
  'bg-[#3D5A80]'
] as const;

export const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** The same seed always gets the same colour, so a profile keeps its face. */
export const profileColor = (seed: string): string =>
  PROFILE_COLORS[hashString(seed) % PROFILE_COLORS.length];

export function generateHouseholdId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = 'h';
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function householdDisplayName(h: Pick<HouseholdDoc, 'id' | 'name'>): string {
  const n = h.name?.trim();
  return n && n.length > 0 ? n : h.id;
}

export function pickActiveHouseholdId(
  households: HouseholdDoc[],
  preferredId: string | null | undefined
): string | null {
  if (households.length === 0) return null;
  if (preferredId && households.some((h) => h.id === preferredId)) return preferredId;
  return households[0].id;
}

export function profileStorageKey(householdId: string, authUid: string): string {
  return `chores_user_${householdId}_${authUid}`;
}

export function activeHouseholdStorageKey(authUid: string): string {
  return `chores_active_household_${authUid}`;
}

/**
 * Fill Google photo only when the profile has none.
 * Never overwrite an existing URL — custom avatar uploads must survive reload
 * (ensureLoginProfile runs on every household open).
 */
export function mergeAuthPhoto(
  existing: { photoURL?: string; linkedAuth?: boolean },
  authPhotoURL: string | null | undefined
): { photoURL?: string } | null {
  if (!authPhotoURL) return null;
  if (existing.photoURL) return null;
  return { photoURL: authPhotoURL };
}
