// Queue / status logic for chore rotations.
//
// Two rules drive everything here:
// 1. A completed occurrence is frozen to the person recorded in
//    `chore.completions[dayKey]`. It never follows the rotation pointer and
//    never reacts to absence changes.
// 2. An uncompleted occurrence is projected from `chore.currentIndex`, skipping
//    residents whose absence window overlaps the day that occurrence lands on.

const MS_PER_DAY = 86400000;

// Firestore rules cap the map at 400 keys; prune well below that on write.
export const COMPLETIONS_MAX_ENTRIES = 366;
export const COMPLETIONS_MAX_AGE_DAYS = 180;

export type ChoreCompletion = {
  userId: string;
  logId?: string | null;
  at: string;
  // A skipped day is resolved but not done: the turn moved past `userId` and
  // the occurrence stays open for whoever comes next.
  skipped?: boolean;
  // A cancelled day is closed without being done. Skipping only hands the turn
  // on and leaves the day owed, so without this an occurrence nobody ever
  // completes stays outstanding for good.
  cancelled?: boolean;
};

export type Chore = {
  id: string;
  name: string;
  // 'once' is an extra round of something added on the day it is needed. It
  // runs through the same completion machinery and then stops occurring.
  frequency: 'daily' | 'weekly' | 'custom_days' | 'once';
  onceDate?: string | null;
  customDays?: number[];
  category?: string;
  rotation: string[];
  currentIndex: number;
  lastCompletedAt: string | null;
  // Most recent completion only; `completions` is the per-day source of truth.
  lastCompletedLogId?: string | null;
  completions?: Record<string, ChoreCompletion>;
  // Day the schedule counts from, set once at creation. Without it a weekly
  // chore has nothing stable to repeat from.
  anchorDate?: string | null;
  // First day the chore exists. Documents written before this field means the
  // schedule has no lower bound, which is the pre-startDate behaviour.
  startDate?: string | null;
};

// Structural subset of the app's UserType, so any richer profile works here.
export type RotationUser = {
  id: string;
  isAbsent?: boolean;
  absentFrom?: string | null;
  absentUntil?: string | null;
};

export const normalizeDay = (d: Date) => {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
};

// Local-date key (YYYY-MM-DD). Lexicographic order matches chronological order,
// which the pruning below relies on.
export const dayKey = (d: Date) => {
  const nd = normalizeDay(d);
  const month = String(nd.getMonth() + 1).padStart(2, '0');
  const day = String(nd.getDate()).padStart(2, '0');
  return `${nd.getFullYear()}-${month}-${day}`;
};

const parseTime = (value?: string | null) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

// --- Absence ---------------------------------------------------------------
// An absence is a datetime window [absentFrom, absentUntil); an open end means
// "until further notice". Profiles written before the window existed only carry
// the boolean, which is treated as an always-on absence.

export const hasAbsenceWindow = (user: RotationUser) =>
  parseTime(user.absentFrom) !== null || parseTime(user.absentUntil) !== null;

export const isUserAbsentNow = (user: RotationUser, at: Date = new Date()) => {
  const from = parseTime(user.absentFrom);
  const until = parseTime(user.absentUntil);
  if (from === null && until === null) return !!user.isAbsent;
  const t = at.getTime();
  if (from !== null && t < from) return false;
  if (until !== null && t >= until) return false;
  return true;
};

// Chores are scheduled per day, so any overlap with the day counts as absent.
export const isUserAbsentOnDay = (user: RotationUser, day: Date) => {
  const from = parseTime(user.absentFrom);
  const until = parseTime(user.absentUntil);
  if (from === null && until === null) return !!user.isAbsent;
  const start = normalizeDay(day).getTime();
  const end = start + MS_PER_DAY;
  if (from !== null && from >= end) return false;
  if (until !== null && until <= start) return false;
  return true;
};

export const absenceWindowLabel = (user: RotationUser, locale = 'he-IL') => {
  const from = parseTime(user.absentFrom);
  const until = parseTime(user.absentUntil);
  if (from === null && until === null) return null;
  const fmt = (t: number) =>
    new Date(t).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  if (from !== null && until !== null) return `${fmt(from)} – ${fmt(until)}`;
  if (from !== null) return `${fmt(from)} –`;
  return `– ${fmt(until as number)}`;
};

// --- Schedule --------------------------------------------------------------

// The day a weekly schedule repeats from. Chores created before `anchorDate`
// existed fall back to their last completion, then to the caller's reference
// day, which is the pre-anchor behaviour.
export const choreAnchorDate = (chore: Chore, fallback: Date) => {
  const explicit = parseTime(chore.anchorDate);
  if (explicit !== null) return normalizeDay(new Date(explicit));
  const lastCompleted = parseTime(chore.lastCompletedAt);
  if (lastCompleted !== null) return normalizeDay(new Date(lastCompleted));
  return normalizeDay(fallback);
};

/** First day the chore exists, or null when it has always existed. */
export const choreStartDate = (chore: Chore) => {
  const start = parseTime(chore.startDate);
  return start === null ? null : normalizeDay(new Date(start));
};

export const choreOccursOnDate = (chore: Chore, date: Date, fallbackAnchor: Date) => {
  // A chore cannot have been due before it existed, so the days already gone by
  // in the week it was created are not occurrences it missed. Gating here means
  // every reader inherits it: the two views, the occurrence walk, and the
  // rotation projection that consumes a turn per open occurrence.
  const start = choreStartDate(chore);
  if (start !== null && normalizeDay(date).getTime() < start.getTime()) return false;

  if (chore.frequency === 'daily') return true;
  if (chore.frequency === 'once') {
    return !!chore.onceDate && dayKey(new Date(chore.onceDate)) === dayKey(date);
  }
  if (chore.frequency === 'custom_days') return !!chore.customDays?.includes(date.getDay());
  const d = normalizeDay(date).getTime();
  const a = choreAnchorDate(chore, fallbackAnchor).getTime();
  const diffDays = Math.round(Math.abs(d - a) / MS_PER_DAY);
  return diffDays % 7 === 0;
};

// Occurrence days between two dates, excluding `startDate` and including
// `endDate`, ordered from nearest to furthest. Walking backwards returns the
// days in reverse-chronological order.
export const listOccurrenceDates = (
  chore: Chore,
  startDate: Date,
  endDate: Date,
  fallbackAnchor?: Date
) => {
  const dates: Date[] = [];
  const start = normalizeDay(startDate);
  const end = normalizeDay(endDate);
  if (start.getTime() === end.getTime()) return dates;

  const direction = start < end ? 1 : -1;
  const current = new Date(start);
  const isNotDone = () =>
    direction === 1 ? current.getTime() < end.getTime() : current.getTime() > end.getTime();
  let loopCount = 0;

  while (isNotDone() && loopCount < 1000) {
    loopCount++;
    current.setDate(current.getDate() + direction);
    current.setHours(0, 0, 0, 0); // Re-normalize to midnight to avoid DST issues

    if (choreOccursOnDate(chore, current, fallbackAnchor ?? start)) dates.push(new Date(current));
  }

  return dates;
};

// Signed occurrence count: negative when `endDate` is in the past.
export const getOccurrencesBetween = (chore: Chore, startDate: Date, endDate: Date) => {
  const count = listOccurrenceDates(chore, startDate, endDate).length;
  return normalizeDay(startDate) <= normalizeDay(endDate) ? count : -count;
};

export const expectedIntervalDays = (chore: Chore) => {
  if (chore.frequency === 'daily' || chore.frequency === 'once') return 1;
  if (chore.frequency === 'weekly') return 7;
  if (chore.frequency === 'custom_days' && chore.customDays && chore.customDays.length > 0) {
    return Math.max(1, Math.round(7 / chore.customDays.length));
  }
  return 7;
};

export const getChoreHealth = (chore: Chore, referenceDate: Date) => {
  const expected = expectedIntervalDays(chore);
  if (!chore.lastCompletedAt) {
    return { daysSince: null as number | null, expected, overdueBy: null as number | null };
  }
  const last = new Date(chore.lastCompletedAt);
  const daysSince = Math.floor(
    (normalizeDay(referenceDate).getTime() - normalizeDay(last).getTime()) / MS_PER_DAY
  );
  return { daysSince, expected, overdueBy: daysSince - expected };
};

// --- Rotation pointer ------------------------------------------------------

const wrap = (index: number, length: number) => ((index % length) + length) % length;

export const getActiveAssigneeIndex = (
  chore: Chore,
  users: RotationUser[],
  startIndex: number,
  onDay: Date
) => {
  const len = chore.rotation?.length ?? 0;
  if (len === 0) return -1;
  const start = wrap(startIndex, len);
  for (let i = 0; i < len; i++) {
    const checkIndex = (start + i) % len;
    const user = users.find(u => u.id === chore.rotation[checkIndex]);
    if (user && !isUserAbsentOnDay(user, onDay)) return checkIndex;
  }
  return start;
};

export const getNextActiveIndex = (
  chore: Chore,
  users: RotationUser[],
  fromIndex: number,
  onDay: Date
) => {
  const len = chore.rotation?.length ?? 0;
  if (len === 0) return 0;
  return getActiveAssigneeIndex(chore, users, wrap(fromIndex + 1, len), onDay);
};

export const getPrevActiveIndex = (
  chore: Chore,
  users: RotationUser[],
  fromIndex: number,
  onDay: Date
) => {
  const len = chore.rotation?.length ?? 0;
  if (len === 0) return 0;
  for (let i = 1; i <= len; i++) {
    const checkIndex = wrap(fromIndex - i, len);
    const user = users.find(u => u.id === chore.rotation[checkIndex]);
    if (user && !isUserAbsentOnDay(user, onDay)) return checkIndex;
  }
  return wrap(fromIndex - 1, len);
};

// --- Completions -----------------------------------------------------------

export type ResolvedCompletion = {
  key: string;
  userId: string | null;
  logId: string | null;
  at: string | null;
  // True for chores written before `completions` existed: we know the day was
  // done but not by whom.
  inferred: boolean;
  skipped: boolean;
  cancelled: boolean;
};

// Any recorded outcome for the day: completed, skipped or cancelled.
export const getDayRecord = (chore: Chore, day: Date): ResolvedCompletion | null => {
  const key = dayKey(day);
  const entry = chore.completions?.[key];
  if (entry && typeof entry.userId === 'string') {
    return {
      key,
      userId: entry.userId,
      logId: entry.logId ?? null,
      at: entry.at ?? null,
      inferred: false,
      skipped: !!entry.skipped,
      cancelled: !!entry.cancelled
    };
  }
  // Once a chore carries a completions map it is the only source of truth;
  // lastCompletedAt is just a denormalised copy of its newest entry.
  const hasMap = !!chore.completions && Object.keys(chore.completions).length > 0;
  if (!hasMap && chore.lastCompletedAt && dayKey(new Date(chore.lastCompletedAt)) === key) {
    return {
      key,
      userId: null,
      logId: chore.lastCompletedLogId ?? null,
      at: chore.lastCompletedAt,
      inferred: true,
      skipped: false,
      cancelled: false
    };
  }
  return null;
};

/**
 * Only days that were actually completed. A skipped day is still open, and a
 * cancelled one is closed without ever having been done.
 */
export const getCompletion = (chore: Chore, day: Date): ResolvedCompletion | null => {
  const record = getDayRecord(chore, day);
  return record && !record.skipped && !record.cancelled ? record : null;
};

export const isDoneOnDay = (chore: Chore, day: Date) => getCompletion(chore, day) !== null;

const pruneCompletions = (completions: Record<string, ChoreCompletion>, today: Date) => {
  const cutoff = new Date(normalizeDay(today).getTime() - COMPLETIONS_MAX_AGE_DAYS * MS_PER_DAY);
  const cutoffKey = dayKey(cutoff);
  const keys = Object.keys(completions)
    .filter(key => key >= cutoffKey)
    .sort();
  const kept = keys.slice(Math.max(0, keys.length - COMPLETIONS_MAX_ENTRIES));
  const out: Record<string, ChoreCompletion> = {};
  for (const key of kept) out[key] = completions[key];
  return out;
};

// Firestore map fields are replaced wholesale, so both writers rebuild the map.
export const withCompletion = (
  chore: Chore,
  day: Date,
  entry: ChoreCompletion,
  today: Date = new Date()
) => {
  const next = pruneCompletions({ ...(chore.completions || {}) }, today);
  next[dayKey(day)] = entry;
  return next;
};

export const withoutCompletion = (chore: Chore, day: Date, today: Date = new Date()) => {
  const next = pruneCompletions({ ...(chore.completions || {}) }, today);
  delete next[dayKey(day)];
  return next;
};

/**
 * Pointer to write when a recorded day is undone, given the chore as it stands
 * before the write and the index the day was frozen to.
 *
 * Handing the turn back to that person is only correct when nothing was
 * recorded after the day: a later completion or skip already moved the pointer
 * past it, and rewinding would hand the same turn out twice. Completing a
 * future occurrence never advanced the pointer, so undoing one never rewinds it
 * either.
 */
export const currentIndexAfterUndo = (
  chore: Chore,
  day: Date,
  restoredIndex: number,
  today: Date = new Date()
) => {
  if (normalizeDay(day).getTime() > normalizeDay(today).getTime()) return chore.currentIndex;
  const key = dayKey(day);
  const hasLaterRecord = Object.keys(chore.completions || {}).some(k => k > key);
  return hasLaterRecord ? chore.currentIndex : restoredIndex;
};

// Local noon, so re-parsing the value can never land on a neighbouring day.
export const dayKeyToDate = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
};

// lastCompletedAt / lastCompletedLogId stay in the document for the health
// indicator and for readers that predate the map; keep them pointing at the
// newest entry so the two representations can never disagree.
export const completionMarkers = (completions: Record<string, ChoreCompletion>) => {
  const keys = Object.keys(completions)
    .filter(key => !completions[key].skipped && !completions[key].cancelled)
    .sort();
  const newest = keys[keys.length - 1];
  if (!newest) return { lastCompletedAt: null, lastCompletedLogId: null };
  return {
    lastCompletedAt: dayKeyToDate(newest).toISOString(),
    lastCompletedLogId: completions[newest].logId ?? null
  };
};

// --- Day resolution --------------------------------------------------------

// Walk from `fromDay` to `toDay`, one step per open occurrence, evaluating
// absence against the day each step lands on.
//
// A completed occurrence is a fact rather than a projection: it re-anchors the
// walk on the person it is frozen to and consumes no turn, which is what keeps
// `currentIndex` meaning "the next open occurrence" after a completion.
export const projectAssigneeIndex = (
  chore: Chore,
  users: RotationUser[],
  startIndex: number,
  fromDay: Date,
  toDay: Date
) => {
  const len = chore.rotation?.length ?? 0;
  if (len === 0) return -1;
  const forward = normalizeDay(fromDay).getTime() <= normalizeDay(toDay).getTime();
  let index = -1;

  // `fromDay` only takes a turn when the chore actually falls on it, otherwise
  // a weekly chore consulted on an off day would burn an extra turn.
  const days = [
    ...(choreOccursOnDate(chore, fromDay, fromDay) ? [normalizeDay(fromDay)] : []),
    ...listOccurrenceDates(chore, fromDay, toDay, fromDay)
  ];

  for (const day of days) {
    const record = getDayRecord(chore, day);
    if (record) {
      const recorded = record.userId ? chore.rotation.indexOf(record.userId) : -1;
      // A skip resolves the day onto the next available resident and, like a
      // completion, takes no turn of its own: the pointer already moved.
      // A cancelled day falls through to the branch below and behaves like a
      // completion here: it re-anchors on the resident who owed it and consumes
      // no turn, so writing a day off never hands the same turn out twice.
      if (record.skipped) {
        if (recorded >= 0) index = getActiveAssigneeIndex(chore, users, recorded + 1, day);
        else if (index === -1) index = getActiveAssigneeIndex(chore, users, startIndex, day);
      } else if (recorded >= 0) {
        index = recorded;
      }
      continue;
    }
    if (index === -1) index = getActiveAssigneeIndex(chore, users, startIndex, day);
    else if (forward) index = getNextActiveIndex(chore, users, index, day);
    else index = getPrevActiveIndex(chore, users, index, day);
  }

  return index === -1 ? getActiveAssigneeIndex(chore, users, startIndex, toDay) : index;
};

/**
 * True when nobody in the rotation can take the chore on that day, either
 * because they are away or because they no longer have a profile. The pointer
 * still lands on someone, so callers have to check this to avoid presenting an
 * absent resident as the assignee.
 */
export const isEveryoneAwayOnDay = (chore: Chore, users: RotationUser[], day: Date) => {
  const rotation = chore.rotation ?? [];
  if (rotation.length === 0) return false;
  return rotation.every(id => {
    const user = users.find(u => u.id === id);
    return !user || isUserAbsentOnDay(user, day);
  });
};

export type DayAssignment = {
  dayKey: string;
  index: number;
  userId?: string;
  done: boolean;
  // Who the undo button must be gated on; null when the rotation is empty.
  completedBy: string | null;
  logId: string | null;
  // A completion recovered from the legacy single marker, so `completedBy` is
  // a best guess rather than a recorded fact.
  inferred: boolean;
  // Resident whose turn was skipped on this day, if any.
  skippedBy: string | null;
  // Resident the day was owed by when it was closed without being done.
  cancelledBy: string | null;
  // Nobody in the rotation is available, so `userId` is a placeholder.
  everyoneAway: boolean;
};

// The single entry point for "who owns this chore on this day".
export const resolveDayAssignee = (
  chore: Chore,
  users: RotationUser[],
  day: Date,
  today: Date = new Date()
): DayAssignment => {
  const record = getDayRecord(chore, day);
  const completion = record && !record.skipped && !record.cancelled ? record : null;

  // Closed without being done: the day is resolved, so it stays pinned to the
  // resident who owed it rather than following the pointer.
  if (record?.cancelled) {
    const index = record.userId ? (chore.rotation?.indexOf(record.userId) ?? -1) : -1;
    return {
      dayKey: record.key,
      index,
      userId: record.userId ?? undefined,
      done: false,
      completedBy: null,
      logId: record.logId,
      inferred: false,
      skippedBy: null,
      cancelledBy: record.userId,
      everyoneAway: false
    };
  }

  if (completion && completion.userId) {
    const index = chore.rotation?.indexOf(completion.userId) ?? -1;
    return {
      dayKey: completion.key,
      index,
      userId: completion.userId,
      done: true,
      completedBy: completion.userId,
      logId: completion.logId,
      inferred: false,
      skippedBy: null,
      cancelledBy: null,
      everyoneAway: false
    };
  }

  if (completion) {
    // Legacy marker: the person who completed it is whoever held the turn just
    // before the pointer advanced.
    const rawActive = getActiveAssigneeIndex(chore, users, chore.currentIndex, day);
    const index = getPrevActiveIndex(chore, users, rawActive, day);
    return {
      dayKey: completion.key,
      index,
      userId: chore.rotation?.[index],
      done: true,
      completedBy: chore.rotation?.[index] ?? null,
      logId: completion.logId,
      inferred: true,
      skippedBy: null,
      cancelledBy: null,
      everyoneAway: false
    };
  }

  const index = projectAssigneeIndex(chore, users, chore.currentIndex, today, day);
  return {
    dayKey: dayKey(day),
    index,
    userId: chore.rotation?.[index],
    done: false,
    completedBy: null,
    logId: null,
    inferred: false,
    skippedBy: record?.skipped ? record.userId : null,
    cancelledBy: null,
    everyoneAway: isEveryoneAwayOnDay(chore, users, day)
  };
};
