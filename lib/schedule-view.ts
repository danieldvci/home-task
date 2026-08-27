// One source of truth for "what does the schedule look like over these days".
//
// The week grid and the day list used to build this separately from the same
// primitives, which let them disagree in ways the rotation engine never did:
// the grid had no notion of a completed day, it silently dropped a chore whose
// turn landed on a profile that no longer exists, it presented an away resident
// as being on duty, and it applied a different set of filters. Both views now
// render from `buildScheduleRows`, so a divergence has to be introduced here to
// exist at all.

import {
  Chore,
  DayAssignment,
  RotationUser,
  choreOccursOnDate,
  dayKey,
  normalizeDay,
  resolveDayAssignee
} from './rotation';

/** Chores saved without a category are grouped under this label. */
export const DEFAULT_CATEGORY = 'אחר';

export type CellState =
  // Not scheduled that day, or filtered out. The only state with no assignment.
  | 'none'
  // Scheduled and still to do, on today or a later day.
  | 'open'
  // Scheduled and still to do, on a day that has already passed.
  | 'overdue'
  | 'done'
  // Closed without being done, so no longer owed by anyone.
  | 'cancelled'
  // Scheduled, but nobody in the rotation can take it.
  | 'unavailable';

export type ScheduleCell = {
  day: Date;
  key: string;
  state: CellState;
  /** null only when `state` is 'none'. */
  assignment: DayAssignment | null;
  /** The resident on duty, or null when nobody is. */
  userId: string | null;
};

export type ScheduleRow = {
  chore: Chore;
  cells: ScheduleCell[];
};

export type ScheduleFilters = {
  /** Empty means every chore. */
  choreIds: string[];
  category: string | 'all';
  personId: string | 'all';
};

export const ALL_TASKS: ScheduleFilters = { choreIds: [], category: 'all', personId: 'all' };

const emptyCell = (day: Date): ScheduleCell => ({
  day,
  key: dayKey(day),
  state: 'none',
  assignment: null,
  userId: null
});

export const buildScheduleCell = (
  chore: Chore,
  users: RotationUser[],
  day: Date,
  personId: string | 'all',
  today: Date
): ScheduleCell => {
  if (!choreOccursOnDate(chore, day, today)) return emptyCell(day);

  const assignment = resolveDayAssignee(chore, users, day, today);
  const userId = assignment.userId ?? null;

  // A completed day is frozen to whoever completed it, so it stays done even if
  // that resident has since left or gone away. A cancelled day is pinned the
  // same way to the resident who owed it when it was closed.
  if (assignment.done || assignment.cancelledBy) {
    if (personId !== 'all' && userId !== personId) return emptyCell(day);
    const state: CellState = assignment.done ? 'done' : 'cancelled';
    return { day, key: dayKey(day), state, assignment, userId };
  }

  // The pointer always lands on somebody, so an open day is only genuinely
  // owned when that somebody still has a profile and is not away that day.
  const owned = !!userId && users.some(u => u.id === userId) && !assignment.everyoneAway;

  // An unowned day belongs to nobody, so it never survives a person filter.
  if (personId !== 'all' && (!owned || userId !== personId)) return emptyCell(day);
  if (!owned) return { day, key: dayKey(day), state: 'unavailable', assignment, userId: null };

  const passed = normalizeDay(day).getTime() < normalizeDay(today).getTime();
  return { day, key: dayKey(day), state: passed ? 'overdue' : 'open', assignment, userId };
};

/**
 * Rows for every chore that has something to show across `days`. Rows where the
 * chore never occurs, or is filtered out, are dropped entirely.
 */
export const buildScheduleRows = (
  chores: Chore[],
  users: RotationUser[],
  days: Date[],
  filters: ScheduleFilters,
  today: Date
): ScheduleRow[] =>
  chores
    .filter(chore => filters.choreIds.length === 0 || filters.choreIds.includes(chore.id))
    .filter(
      chore =>
        filters.category === 'all' || (chore.category || DEFAULT_CATEGORY) === filters.category
    )
    .map(chore => ({
      chore,
      cells: days.map(day => buildScheduleCell(chore, users, day, filters.personId, today))
    }))
    .filter(row => row.cells.some(cell => cell.state !== 'none'));

/**
 * How far back a carried-over task is traced. Two weeks is enough to surface a
 * task that keeps being put off without walking the whole completions map on
 * every render.
 */
export const MISSED_LOOKBACK_DAYS = 14;

/**
 * Occurrences before `before` that were never completed, most recent first.
 *
 * Derived on read rather than written to Firestore. There is no server here, so
 * a stored "missed" record would have to be written by whichever browser
 * happened to be open at midnight: several open tabs would race to write the
 * same record, and a household that did not open the app would leave holes in
 * the data. Recomputing costs nothing and cannot drift.
 */
export const missedOccurrences = (
  chore: Chore,
  users: RotationUser[],
  before: Date,
  today: Date,
  lookbackDays: number = MISSED_LOOKBACK_DAYS
): ScheduleCell[] => {
  const missed: ScheduleCell[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const cell = buildScheduleCell(chore, users, shiftDays(before, -i), 'all', today);
    // Only a day somebody could actually have done. A day when the whole
    // rotation was away is nobody's debt.
    if (cell.state === 'overdue') missed.push(cell);
  }
  return missed;
};

/** The Sunday-to-Saturday week containing `date`. */
export const weekAround = (date: Date): Date[] => {
  const sunday = normalizeDay(date);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });
};

export const shiftDays = (date: Date, days: number) => {
  const d = normalizeDay(date);
  d.setDate(d.getDate() + days);
  return d;
};
