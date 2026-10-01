/**
 * What a brand-new household starts with.
 *
 * A household that has just been created has one resident and no chores, and
 * the two things it needs are three taps deep in a collapsed settings section.
 * This module holds the part of the first run that is decidable without a
 * screen: which chores to suggest, and what the documents for the chosen ones
 * have to look like.
 *
 * It writes nothing. `buildSetupPlan` returns the documents and the caller
 * commits them in one batch, so a household is never left with residents but
 * no chores because the second write failed.
 */

import { normalizeDay } from './rotation';
import { profileColor } from './household-utils';
import { fallbackUserIcon } from './default-icons';
import type { ChoreIconId, UserIconId } from './default-icons';

export type SetupFrequency = 'daily' | 'weekly' | 'custom_days';

export type StarterTemplate = {
  id: string;
  name: string;
  frequency: SetupFrequency;
  /** Weekday numbers, Sunday first, for `custom_days` only. */
  customDays?: number[];
  category: string;
  icon: ChoreIconId;
  /** Ticked when the wizard opens. Everything else is one tap away. */
  suggested: boolean;
};

/**
 * The chores almost every household has, and a few that many do. Suggested
 * ones are the five that came up in every list we compared against; the rest
 * are offered unticked so the first screen is a short one.
 *
 * Categories are the app's own, so a starter chore is filterable on the day it
 * is created.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze([
  { id: 'dishes', name: 'שטיפת כלים', frequency: 'daily', category: 'מטבח', icon: 'dishes', suggested: true },
  { id: 'trash', name: 'הוצאת זבל', frequency: 'daily', category: 'חוץ', icon: 'trash', suggested: true },
  { id: 'tidy-kitchen', name: 'סידור המטבח', frequency: 'daily', category: 'מטבח', icon: 'tidy', suggested: true },
  {
    id: 'laundry',
    name: 'כביסה',
    frequency: 'custom_days',
    customDays: [0, 3],
    category: 'אחר',
    icon: 'laundry',
    suggested: true
  },
  { id: 'floors', name: 'שטיפת רצפות', frequency: 'weekly', category: 'סלון', icon: 'sweep', suggested: true },
  { id: 'bathroom', name: 'ניקיון האמבטיה', frequency: 'weekly', category: 'אמבטיה', icon: 'bathroom', suggested: false },
  { id: 'beds', name: 'סידור המיטות', frequency: 'daily', category: 'חדר שינה', icon: 'bed', suggested: false },
  { id: 'shopping', name: 'קניות לבית', frequency: 'weekly', category: 'חוץ', icon: 'shopping', suggested: false },
  { id: 'pets', name: 'טיפול בחיות המחמד', frequency: 'daily', category: 'חוץ', icon: 'pets', suggested: false },
  { id: 'plants', name: 'השקיית צמחים', frequency: 'weekly', category: 'חוץ', icon: 'plants', suggested: false }
]);

/** Leaves room under the 20-resident ceiling for accounts that join later. */
export const SETUP_MAX_RESIDENTS = 12;

export type ResidentDraft = {
  /** The id the profile will be written under, assigned before the chores are
   *  built so a rotation can name a resident that does not exist yet. */
  id: string;
  name: string;
  icon?: UserIconId;
};

export type ChoreDraft = {
  id: string;
  name: string;
  frequency: SetupFrequency;
  customDays?: number[];
  category?: string;
  icon: ChoreIconId;
  /** Resident ids in turn order. May name the owner, who already exists. */
  rotation: string[];
};

export type SetupDraft = {
  residents: ResidentDraft[];
  chores: ChoreDraft[];
};

export type UserWrite = {
  name: string;
  color: string;
  isAbsent: boolean;
  linkedAuth: boolean;
  icon: UserIconId;
};

export type ChoreWrite = {
  name: string;
  frequency: SetupFrequency;
  rotation: string[];
  currentIndex: number;
  icon: ChoreIconId;
  category?: string;
  customDays?: number[];
  anchorDate: string;
  startDate: string;
};

export type SetupPlan = {
  users: { id: string; data: UserWrite }[];
  chores: { id: string; data: ChoreWrite }[];
};

/**
 * Names as typed, cleaned up. People paste a family in one go, and a trailing
 * comma or a blank line should not become a resident called "".
 */
export const normalizeResidentNames = (input: string): string[] => {
  const seen = new Set<string>();
  return input
    .split(/[\n,]/)
    .map(part => part.trim().replace(/\s+/g, ' ').slice(0, 100))
    .filter(name => {
      if (name.length === 0 || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, SETUP_MAX_RESIDENTS);
};

/**
 * Why the draft cannot be committed, in the words the wizard shows. Empty
 * means it can. Returned rather than thrown because these are things the user
 * is in the middle of fixing, not faults.
 */
export const setupDraftProblems = (
  draft: SetupDraft,
  /** Residents that already exist, which in practice is the owner's profile. */
  existingResidentIds: readonly string[] = []
): string[] => {
  const problems: string[] = [];
  const knownResidents = new Set([...existingResidentIds, ...draft.residents.map(r => r.id)]);

  if (draft.residents.some(r => r.name.trim().length === 0)) {
    problems.push('לכל דייר צריך שם');
  }
  if (draft.residents.length > SETUP_MAX_RESIDENTS) {
    problems.push(`אפשר להוסיף עד ${SETUP_MAX_RESIDENTS} דיירים כאן`);
  }
  for (const chore of draft.chores) {
    if (chore.name.trim().length === 0) {
      problems.push('לכל משימה שנבחרה צריך שם');
      break;
    }
  }
  for (const chore of draft.chores) {
    if (chore.rotation.length === 0) {
      problems.push(`למשימה "${chore.name.trim()}" לא נבחרו משתתפים`);
    }
  }
  for (const chore of draft.chores) {
    if (chore.frequency === 'custom_days' && (chore.customDays?.length ?? 0) === 0) {
      problems.push(`למשימה "${chore.name.trim()}" לא נבחרו ימים`);
    }
  }
  // A rotation naming somebody who is not being created and is not already a
  // resident resolves to `unavailable` on every day - a chore nobody can do.
  for (const chore of draft.chores) {
    if (chore.rotation.some(id => !knownResidents.has(id))) {
      problems.push(`למשימה "${chore.name.trim()}" יש משתתף שאינו קיים`);
    }
  }
  return [...new Set(problems)];
};

/**
 * The documents to write, ready for a batch.
 *
 * `residents` here is only the profiles being created: the owner already has
 * one, so they are passed as an existing id in a rotation and never appear in
 * `plan.users`. Dates are fixed once, here, for the same reason a chore fixes
 * `anchorDate` at creation - a schedule that repeats from "whenever this was
 * read" repeats from a different day every time.
 */
export const buildSetupPlan = (
  draft: SetupDraft,
  today: Date,
  existingResidentIds: readonly string[] = []
): SetupPlan => {
  const problems = setupDraftProblems(draft, existingResidentIds);
  if (problems.length > 0) {
    throw new Error(`setup draft is not valid: ${problems.join('; ')}`);
  }

  const day = normalizeDay(today).toISOString();

  return {
    users: draft.residents.map(resident => ({
      id: resident.id,
      data: {
        name: resident.name.trim(),
        color: profileColor(resident.id),
        isAbsent: false,
        // Nobody signs in as one of these: they are the family members who
        // never open the app, acted for from whichever phone is to hand.
        linkedAuth: false,
        icon: resident.icon ?? fallbackUserIcon(resident.id)
      }
    })),
    chores: draft.chores.map(chore => {
      const data: ChoreWrite = {
        name: chore.name.trim(),
        frequency: chore.frequency,
        rotation: [...chore.rotation],
        currentIndex: 0,
        icon: chore.icon,
        anchorDate: day,
        // Created today, so the days already gone by this week are not days it
        // missed.
        startDate: day
      };
      // Written only when they carry something: firestore.rules validates a
      // chore by exact key count, so an empty optional is a rejected write.
      if (chore.category) data.category = chore.category;
      if (chore.frequency === 'custom_days' && chore.customDays?.length) {
        data.customDays = [...chore.customDays].sort((a, b) => a - b);
      }
      return { id: chore.id, data };
    })
  };
};
