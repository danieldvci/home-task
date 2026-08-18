/** Pure helpers for household identity and display (testable without Firebase). */

export type HouseholdDoc = {
  id: string;
  ownerId: string;
  members: string[];
  name?: string;
};

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

/** Merge Google photo into an existing linked profile without clobbering edited name/color. */
export function mergeAuthPhoto(
  existing: { photoURL?: string; linkedAuth?: boolean },
  authPhotoURL: string | null | undefined
): { photoURL?: string } | null {
  if (!authPhotoURL) return null;
  if (existing.photoURL === authPhotoURL) return null;
  return { photoURL: authPhotoURL };
}
