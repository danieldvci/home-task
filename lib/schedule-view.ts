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
  Residents,
  choreOccursOnDate,
  choreStartDate,
  dayKey,
  getDayRecord,
  indexUsers,
  isResident,
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
  /**
   * The day this occurrence left for, when it was moved off this one.
   *
   * Such a day has no occurrence, so it resolves to `none` - and looked exactly
   * like a day the chore never fell on. It is not free space: `dropTargets`
   * refuses it, deliberately, because landing there would leave the same day
   * both suppressed and relocated onto. The grid needs to be able to say so
   * rather than accept a drag and silently drop it.
   */
  vacatedTo: string | null;
};

export type ScheduleRow = {
  chore: Chore;
  cells: ScheduleCell[];
};

// --- How a state looks ------------------------------------------------------
//
// `buildScheduleRows` exists so the two views cannot disagree about a date.
// Nothing used to stop them disagreeing about how a date *looks*, and they did:
// the day list called an overdue day `באיחור` and tinted it #B9553D, the week
// grid called the same day `לא בוצע` and drew its legend swatch in rose-500,
// `open` was styled identically to `none`, and `cancelled` was styled
// identically to `unavailable` despite meaning the opposite thing - one is a
// decision somebody made, the other is the app reporting it has nobody to ask.
//
// Everything that draws a chore-and-day pair resolves through the table below:
// the day list, the week grid, the grid's own legend, and the activity log's
// action pills. A divergence now has to be introduced here to exist.
//
// The glyph is a name rather than a component so this module stays free of
// React and keeps running under `tsx` in the test suite. Callers map it.
//
// Colour is never the only difference. This is a household app used by
// children, and red-against-green is the commonest colour-blindness axis, so
// every state also differs by glyph, and `cancelled` differs from
// `unavailable` by border style as well as by tint.

export type StateGlyph = 'none' | 'clock' | 'alert' | 'forward' | 'check' | 'x' | 'userX';

export type StatePresentation = {
  /** One label per state, in every view. */
  label: string;
  glyph: StateGlyph;
  /** Nothing is owed: the day is done or written off. */
  settled: boolean;
  /** Somebody still owes this day. */
  owed: boolean;
  /** Card surface in the day list. */
  surface: string;
  /** Badge or pill, on a card or in the legend. */
  badge: string;
  /** The marker on a week-grid cell, and its swatch in the legend. */
  dot: string;
};

/**
 * Frozen, and keyed by state so a lookup is a lookup.
 *
 * `statePresentation` runs once per rendered cell and a week grid is chores
 * times seven cells wide, so this deliberately does not build an object or
 * compose a class string per call.
 */
const STATE_PRESENTATION: Readonly<Record<CellState, StatePresentation>> = Object.freeze({
  none: {
    label: 'לא בתוכנית',
    glyph: 'none',
    settled: false,
    owed: false,
    surface: 'bg-sunken border-line',
    badge: 'text-ink-ghost bg-transparent',
    dot: 'bg-transparent'
  },
  open: {
    label: 'להשלמה',
    glyph: 'clock',
    settled: false,
    owed: true,
    surface: 'bg-card border-line shadow-sm',
    badge: 'text-accent bg-accent/10',
    dot: 'bg-accent-soft'
  },
  overdue: {
    label: 'באיחור',
    glyph: 'alert',
    settled: false,
    owed: true,
    surface: 'bg-owed/[0.07] border-owed/30',
    badge: 'text-owed bg-owed/10',
    dot: 'bg-owed'
  },
  done: {
    label: 'בוצע',
    glyph: 'check',
    settled: true,
    owed: false,
    surface: 'bg-settled/10 border-settled/40',
    badge: 'text-settled-ink bg-settled/20',
    dot: 'bg-settled'
  },
  cancelled: {
    // Written off on purpose. The dashed border is the tell that separates this
    // from `unavailable`, which shares its muted tint but means the opposite.
    label: 'ויתרנו',
    glyph: 'x',
    settled: true,
    owed: false,
    surface: 'bg-sunken border-dashed border-line-strong',
    badge: 'text-ink-mid bg-inset',
    dot: 'bg-closed'
  },
  unavailable: {
    label: 'אין דייר זמין',
    glyph: 'userX',
    settled: false,
    // Owed by nobody. The rotation is empty, everyone in it is away, or the
    // resident holding it has been deleted - the app's problem, not the
    // household's, so this must not read as a debt anybody can settle.
    owed: false,
    surface: 'bg-inset border-line',
    badge: 'text-ink-muted bg-inset',
    dot: 'bg-idle'
  }
});

export const statePresentation = (state: CellState): StatePresentation =>
  STATE_PRESENTATION[state];

/**
 * A skip is not a state, and this is where that stops being invisible.
 *
 * Skipping hands the turn to the next resident and leaves the day itself open,
 * so it still resolves as `open` or `overdue` and is still owed - which is
 * exactly right and exactly why it had nowhere to be drawn. The day list
 * carried it as the lowest-contrast text in the card and the week grid did not
 * carry it at all.
 *
 * So it is a modifier on a state rather than a state, and it is a constant
 * rather than a computed object for the same reason the table above is.
 */
export const HANDED_ON: Readonly<Pick<StatePresentation, 'label' | 'glyph' | 'badge' | 'dot'>> =
  Object.freeze({
    label: 'הועבר הלאה',
    glyph: 'forward',
    badge: 'text-handed-on bg-handed-on/10',
    dot: 'bg-handed-on'
  });

/** True when this day's turn was passed on and the day is still owed. */
export const isHandedOn = (cell: ScheduleCell) =>
  !!cell.assignment?.skippedBy && statePresentation(cell.state).owed;

/**
 * How a relocated day says so. `rearranged` and `movedFrom` were already
 * carried on every cell for this and only the grid ever read them, as a 12px
 * badge; the day list said nothing at all.
 */
export const RELOCATED: Readonly<{ moved: string; traded: string; badge: string; dot: string }> =
  Object.freeze({
    moved: 'הועבר',
    traded: 'הוחלף',
    badge: 'text-relocated bg-relocated/15',
    dot: 'bg-relocated'
  });

export type ScheduleFilters = {
  /** Empty means every chore. */
  choreIds: string[];
  category: string | 'all';
  personId: string | 'all';
};

export const ALL_TASKS: ScheduleFilters = { choreIds: [], category: 'all', personId: 'all' };

const emptyCell = (day: Date, vacatedTo: string | null = null): ScheduleCell => ({
  day,
  key: dayKey(day),
  state: 'none',
  assignment: null,
  userId: null,
  movedFrom: null,
  rearranged: false,
  vacatedTo
});

const provenance = (assignment: DayAssignment) => ({
  movedFrom: assignment.movedFrom,
  rearranged: !!assignment.assignedTo,
  // A day that still has an occurrence has not been vacated of one.
  vacatedTo: null
});

export const buildScheduleCell = (
  chore: Chore,
  users: Residents,
  day: Date,
  personId: string | 'all',
  today: Date
): ScheduleCell => {
  if (!choreOccursOnDate(chore, day, today)) {
    // A day with nothing on it and a day whose occurrence was moved away both
    // resolve to `none`, and only one of them is free space.
    return emptyCell(day, getDayRecord(chore, day)?.movedTo ?? null);
  }

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
  const owned = !!userId && isResident(users, userId) && !assignment.everyoneAway;

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
  users: Residents,
  days: Date[],
  filters: ScheduleFilters,
  today: Date
): ScheduleRow[] => {
  // One index for the whole pass. Every cell below needs the same lookup, and a
  // pass is chores times days cells wide.
  const residents = indexUsers(users);
  return chores
    .filter(chore => filters.choreIds.length === 0 || filters.choreIds.includes(chore.id))
    .filter(
      chore =>
        filters.category === 'all' || (chore.category || DEFAULT_CATEGORY) === filters.category
    )
    .map(chore => ({
      chore,
      cells: days.map(day => buildScheduleCell(chore, residents, day, filters.personId, today))
    }))
    .filter(row => row.cells.some(cell => cell.state !== 'none'));
};

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
  users: Residents,
  days: Date[],
  sourceIndex: number,
  today: Date
): DropTarget[] => {
  const residents = indexUsers(users);
  const cells = days.map(day => buildScheduleCell(chore, residents, day, 'all', today));
  const source = cells[sourceIndex];
  if (!source || !isPickable(source)) return [];

  const start = choreStartDate(chore);
  const startTime = start?.getTime();
  // Rescheduling work, not rewriting history.
  //
  // Picking a past day *up* is correct and stays: `isPickable` allows
  // `overdue`, and moving an unpaid debt forward onto a day somebody can
  // actually do it is the main reason dragging exists. It is only the target
  // side that needs a floor. Without one an occurrence could be dropped onto a
  // day that had already gone, and two past days could be traded with each
  // other - neither of which resolves anything.
  const floor = normalizeDay(today).getTime();
  const targets: DropTarget[] = [];

  for (const [index, cell] of cells.entries()) {
    if (index === sourceIndex) continue;
    const dayTime = normalizeDay(cell.day).getTime();
    // The chore did not exist yet, so it cannot have been due then.
    if (startTime !== undefined && dayTime < startTime) continue;
    if (dayTime < floor) continue;

    if (cell.state === 'none') {
      // A day whose own occurrence was moved away also reads as empty. Landing
      // on it would leave the same day both suppressed and relocated onto, so
      // it is refused here and drawn as occupied - see `vacatedTo`.
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
  users: Residents,
  before: Date,
  today: Date,
  lookbackDays: number = MISSED_LOOKBACK_DAYS
): ScheduleCell[] => {
  const residents = indexUsers(users);
  const missed: ScheduleCell[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const cell = buildScheduleCell(chore, residents, shiftDays(before, -i), 'all', today);
    // Only a day somebody could actually have done. A day when the whole
    // rotation was away is nobody's debt.
    if (cell.state === 'overdue') missed.push(cell);
  }
  return missed;
};

const MS_PER_DAY = 86400000;

const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * The day as somebody would say it out loud, for copy aimed at a resident
 * rather than at whoever built this.
 *
 * A weekday name stops being useful once it is more than a week old, because
 * "מיום שישי" no longer says which Friday, so the date takes over at seven
 * days. Anything that is not in the past falls through to the date as well.
 */
export const relativeDayLabel = (day: Date, today: Date) => {
  const diff = Math.round(
    (normalizeDay(today).getTime() - normalizeDay(day).getTime()) / MS_PER_DAY
  );
  if (diff === 0) return 'מהיום';
  if (diff === 1) return 'מאתמול';
  if (diff > 1 && diff < 7) return `מיום ${WEEKDAY_NAMES[day.getDay()]}`;
  return `מ־${day.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`;
};

/**
 * The carry-over line on today's card.
 *
 * Counting is clearer than dating once a task has been put off more than once:
 * the reader wants to know it keeps slipping, not which particular day it
 * started. `missedOccurrences` returns most recent first, so the oldest entry
 * is the one that dates the debt.
 */
export const carryOverLabel = (missed: ScheduleCell[], today: Date) =>
  missed.length > 1
    ? `נדחה ${missed.length} פעמים`
    : `נדחה ${relativeDayLabel(missed[missed.length - 1].day, today)}`;

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
