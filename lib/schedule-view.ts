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
  choreStartDate,
  dayKey,
  getDayRecord,
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
  /** The day this occurrence was dragged here from, when it was moved. */
  movedFrom: string | null;
  /** True when the resident on duty was chosen by a move or a swap rather than
   *  by the queue, so the grid can say why it is not whose turn it looks like. */
  rearranged: boolean;
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
  userId: null,
  movedFrom: null,
  rearranged: false
});

const provenance = (assignment: DayAssignment) => ({
  movedFrom: assignment.movedFrom,
  rearranged: !!assignment.assignedTo
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
    return { day, key: dayKey(day), state, assignment, userId, ...provenance(assignment) };
  }

  // The pointer always lands on somebody, so an open day is only genuinely
  // owned when that somebody still has a profile and is not away that day.
  const owned = !!userId && users.some(u => u.id === userId) && !assignment.everyoneAway;

  // An unowned day belongs to nobody, so it never survives a person filter.
  if (personId !== 'all' && (!owned || userId !== personId)) return emptyCell(day);
  if (!owned) {
    return {
      day,
      key: dayKey(day),
      state: 'unavailable',
      assignment,
      userId: null,
      ...provenance(assignment)
    };
  }

  const passed = normalizeDay(day).getTime() < normalizeDay(today).getTime();
  return {
    day,
    key: dayKey(day),
    state: passed ? 'overdue' : 'open',
    assignment,
    userId,
    ...provenance(assignment)
  };
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

/** Dropping on an empty day relocates the occurrence; dropping on somebody
 *  else's day trades the two. */
export type DropKind = 'move' | 'swap';

export type DropTarget = { index: number; kind: DropKind };

/** A day can only be picked up while it is still owed by somebody: a finished
 *  or written-off day has nothing left to reschedule. */
export const isPickable = (cell: ScheduleCell) =>
  (cell.state === 'open' || cell.state === 'overdue') && !!cell.userId;

/**
 * Which days in a row a picked occurrence may be dropped on, and what dropping
 * there would mean.
 *
 * Built from the unfiltered schedule rather than the rendered row. A person
 * filter renders another resident's day as an empty cell, and treating that as
 * somewhere to move to would overwrite a day the user cannot even see. Callers
 * that render filtered rows have to keep the index mapping identical, which is
 * why this takes the same `days` array the row was built from.
 */
export const dropTargets = (
  chore: Chore,
  users: RotationUser[],
  days: Date[],
  sourceIndex: number,
  today: Date
): DropTarget[] => {
  const cells = days.map(day => buildScheduleCell(chore, users, day, 'all', today));
  const source = cells[sourceIndex];
  if (!source || !isPickable(source)) return [];

  const start = choreStartDate(chore);
  const targets: DropTarget[] = [];

  for (const [index, cell] of cells.entries()) {
    if (index === sourceIndex) continue;
    // The chore did not exist yet, so it cannot have been due then.
    if (start && normalizeDay(cell.day).getTime() < start.getTime()) continue;

    if (cell.state === 'none') {
      // A day whose own occurrence was moved away also reads as empty. Landing
      // on it would leave the same day both suppressed and relocated onto.
      if (!getDayRecord(chore, cell.day)) targets.push({ index, kind: 'move' });
      continue;
    }
    // Trading needs somebody on the other end to trade with, and swapping a day
    // with itself is not a change.
    if (isPickable(cell) && cell.userId !== source.userId) targets.push({ index, kind: 'swap' });
  }

  return targets;
};

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

export const DAY_STRIP_BEFORE = 3;
export const DAY_STRIP_AFTER = 7;
const DAY_STRIP_LENGTH = DAY_STRIP_BEFORE + DAY_STRIP_AFTER + 1;

/**
 * The day view's counterpart to `weekAround`: the days its selector offers.
 *
 * Anchored on today, but it must always contain `selected`. The strip is the
 * only place the day view names the date it is showing, so a selection outside
 * it left the user reading a list of tasks for an unlabelled day, and marking
 * one done there backdates the completion. The week arrows and the carry-over
 * badge, which reaches `MISSED_LOOKBACK_DAYS` back, both push the selection
 * well past a window fixed to today.
 */
export const dayStripDays = (today: Date, selected: Date): Date[] => {
  const anchored = shiftDays(today, -DAY_STRIP_BEFORE);
  const sel = normalizeDay(selected).getTime();
  const inRange =
    sel >= anchored.getTime() && sel <= shiftDays(today, DAY_STRIP_AFTER).getTime();
  // Centred rather than nudged just far enough, so a jump lands with the days
  // either side of the target reachable instead of pinned to an edge.
  const start = inRange ? anchored : shiftDays(selected, -Math.floor(DAY_STRIP_LENGTH / 2));
  return Array.from({ length: DAY_STRIP_LENGTH }, (_, i) => shiftDays(start, i));
};
