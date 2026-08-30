import assert from 'node:assert/strict';
import {
  MISSED_LOOKBACK_DAYS,
  buildScheduleCell,
  buildScheduleRows,
  dayStripDays,
  missedOccurrences,
  weekAround,
  shiftDays
} from '../lib/schedule-view';
import type { ScheduleFilters } from '../lib/schedule-view';
import { completionMarkers, dayKey, normalizeDay } from '../lib/rotation';
import type { Chore, RotationUser } from '../lib/rotation';

// Aug 18 2026 is a Tuesday.
const TUE = new Date(2026, 7, 18, 12, 0, 0);
const WED = new Date(2026, 7, 19, 12, 0, 0);
const MON = new Date(2026, 7, 17, 12, 0, 0);

const makeChore = (over: Partial<Chore> = {}): Chore => ({
  id: 'c1',
  name: 'כלים',
  frequency: 'daily',
  rotation: ['u1', 'u2', 'u3'],
  currentIndex: 0,
  lastCompletedAt: null,
  ...over
});

const present = (id: string): RotationUser => ({ id, isAbsent: false });
const trio = [present('u1'), present('u2'), present('u3')];
const ALL: ScheduleFilters = { choreIds: [], category: 'all', personId: 'all' };

// The whole point of the module: whatever the day list shows for a date has to
// be what the week grid shows in that date's column. These assert the two are
// the same call, for the cases where the old code disagreed.

// --- The states the week grid used to be blind to ---------------------------

{
  const cell = buildScheduleCell(makeChore(), trio, TUE, 'all', TUE);
  assert.equal(cell.state, 'open', 'today, nothing recorded');
  assert.equal(cell.userId, 'u1');
  assert.equal(cell.key, dayKey(TUE));
}

{
  const done = makeChore({
    completions: { [dayKey(TUE)]: { userId: 'u3', at: TUE.toISOString() } },
    currentIndex: 1
  });
  const cell = buildScheduleCell(done, trio, TUE, 'all', TUE);
  assert.equal(cell.state, 'done', 'a completed day reads as done, not as an open turn');
  assert.equal(cell.userId, 'u3', 'and is frozen to whoever completed it');
}

{
  // Monday came and went with nothing recorded.
  const cell = buildScheduleCell(makeChore(), trio, MON, 'all', TUE);
  assert.equal(cell.state, 'overdue', 'a passed day with no record is overdue, not merely open');
}

{
  const cell = buildScheduleCell(makeChore(), trio, WED, 'all', TUE);
  assert.equal(cell.state, 'open', 'a future day is open rather than overdue');
}

// --- Cases where the two views used to contradict each other ----------------

{
  // Week showed the avatar of whoever the pointer landed on; day said nobody
  // was available.
  const away = trio.map(u => ({ ...u, isAbsent: true }));
  const cell = buildScheduleCell(makeChore(), away, TUE, 'all', TUE);
  assert.equal(cell.state, 'unavailable', 'everyone away is unavailable in both views');
  assert.equal(cell.userId, null, 'and reports no owner rather than a placeholder');
}

{
  // Week hid the cell (and could drop the whole row); day showed a card.
  const cell = buildScheduleCell(makeChore({ rotation: ['ghost'] }), trio, TUE, 'all', TUE);
  assert.equal(cell.state, 'unavailable', 'a turn on a deleted profile is unavailable, not hidden');
  assert.equal(cell.userId, null);
}

{
  const cell = buildScheduleCell(makeChore({ rotation: [] }), trio, TUE, 'all', TUE);
  assert.equal(cell.state, 'unavailable', 'an empty rotation is unavailable, not hidden');
}

{
  // A day nobody can take belongs to nobody, so it must not surface under a
  // person filter just because the pointer happened to stop there.
  const away = trio.map(u => ({ ...u, isAbsent: true }));
  const cell = buildScheduleCell(makeChore(), away, TUE, 'u1', TUE);
  assert.equal(cell.state, 'none', 'an unavailable day matches no person filter');
}

// --- Occurrence rules -------------------------------------------------------

{
  const weekly = makeChore({ frequency: 'weekly', anchorDate: normalizeDay(TUE).toISOString() });
  assert.equal(buildScheduleCell(weekly, trio, TUE, 'all', TUE).state, 'open');
  assert.equal(
    buildScheduleCell(weekly, trio, WED, 'all', TUE).state,
    'none',
    'a weekly chore does not occur the day after its anchor'
  );
}

{
  // The week grid used to leave one-off tasks out entirely while the day list
  // showed them, which is a divergence by construction.
  const once = makeChore({ frequency: 'once', onceDate: normalizeDay(TUE).toISOString() });
  const rows = buildScheduleRows([once], trio, weekAround(TUE), ALL, TUE);
  assert.equal(rows.length, 1, 'a one-off task appears in a week that contains it');
  assert.deepEqual(
    rows[0].cells.map(c => c.state),
    ['none', 'none', 'open', 'none', 'none', 'none', 'none'],
    'on exactly its own day'
  );
}

// --- Filters, which used to be wired up per view ----------------------------

{
  const kitchen = makeChore({ id: 'a', category: 'מטבח' });
  const other = makeChore({ id: 'b' });
  const chores = [kitchen, other];

  assert.deepEqual(
    buildScheduleRows(chores, trio, [TUE], ALL, TUE).map(r => r.chore.id),
    ['a', 'b'],
    'no filter shows everything'
  );
  assert.deepEqual(
    buildScheduleRows(chores, trio, [TUE], { ...ALL, choreIds: ['b'] }, TUE).map(r => r.chore.id),
    ['b'],
    'the task filter selects a subset'
  );
  assert.deepEqual(
    buildScheduleRows(chores, trio, [TUE], { ...ALL, category: 'מטבח' }, TUE).map(r => r.chore.id),
    ['a'],
    'the category filter applies to both views, not just the day list'
  );
  assert.deepEqual(
    buildScheduleRows(chores, trio, [TUE], { ...ALL, category: 'אחר' }, TUE).map(r => r.chore.id),
    ['b'],
    'an uncategorised chore falls under the default category'
  );
}

{
  const rows = buildScheduleRows([makeChore()], trio, weekAround(TUE), { ...ALL, personId: 'u2' }, TUE);
  const owners = rows[0].cells.map(c => c.userId);
  assert.ok(
    owners.every(id => id === null || id === 'u2'),
    'a person filter blanks other residents rather than reassigning them'
  );
  assert.ok(owners.some(id => id === 'u2'), 'and keeps that resident’s own days');
}

{
  const rows = buildScheduleRows([makeChore()], trio, [TUE], { ...ALL, personId: 'u2' }, TUE);
  assert.equal(rows.length, 0, 'a row with nothing left after filtering is dropped');
}

// --- Week and day agree, day for day ----------------------------------------

{
  // The original bug, asserted directly: build a week, then build each of its
  // days on its own, and require the two to match cell for cell.
  const chore = makeChore({
    completions: {
      [dayKey(MON)]: { userId: 'u1', at: MON.toISOString() },
      [dayKey(TUE)]: { userId: 'u2', at: TUE.toISOString(), skipped: true }
    },
    currentIndex: 1
  });
  const week = weekAround(TUE);
  const grid = buildScheduleRows([chore], trio, week, ALL, TUE)[0];

  week.forEach((day, i) => {
    const [single] = buildScheduleRows([chore], trio, [day], ALL, TUE);
    const fromGrid = grid.cells[i];
    assert.equal(fromGrid.state, single?.cells[0].state ?? 'none', `state agrees on ${dayKey(day)}`);
    assert.equal(fromGrid.userId, single?.cells[0].userId ?? null, `owner agrees on ${dayKey(day)}`);
  });
}

// --- Week window ------------------------------------------------------------

{
  const week = weekAround(TUE);
  assert.equal(week.length, 7);
  assert.equal(week[0].getDay(), 0, 'starts on Sunday');
  assert.equal(week[6].getDay(), 6, 'ends on Saturday');
  assert.ok(
    week.some(d => dayKey(d) === dayKey(TUE)),
    'contains the date it was built around'
  );
  assert.equal(
    dayKey(weekAround(shiftDays(TUE, 7))[0]),
    dayKey(shiftDays(week[0], 7)),
    'stepping a week forward moves the window by exactly seven days'
  );
  // The week used to be pinned to the current date, so picking a day in the day
  // view and switching to the week view showed a different week.
  const nextWeek = weekAround(shiftDays(TUE, 7));
  assert.ok(
    !nextWeek.some(d => dayKey(d) === dayKey(TUE)),
    'the window follows the selected date rather than today'
  );
}

// --- A new chore does not backfill the days before it existed ---------------

{
  // Created today, so the earlier days of this week are not occurrences it
  // missed. Without the gate these rendered a full rotation of avatars.
  const fresh = makeChore({ startDate: normalizeDay(TUE).toISOString() });
  const week = weekAround(TUE);
  const [row] = buildScheduleRows([fresh], trio, week, ALL, TUE);

  week.forEach((day, i) => {
    const before = normalizeDay(day).getTime() < normalizeDay(TUE).getTime();
    if (before) {
      assert.equal(row.cells[i].state, 'none', `${dayKey(day)} predates the chore`);
      assert.equal(row.cells[i].userId, null, `${dayKey(day)} assigns nobody`);
    } else {
      assert.notEqual(row.cells[i].state, 'none', `${dayKey(day)} is a real occurrence`);
    }
  });
}

{
  // A brand new chore cannot already be behind.
  const fresh = makeChore({ startDate: normalizeDay(TUE).toISOString() });
  assert.deepEqual(missedOccurrences(fresh, trio, TUE, TUE), [], 'nothing is missed on day one');
}

{
  // Chores written before the field existed keep behaving exactly as they did.
  const legacy = makeChore();
  assert.equal(
    buildScheduleCell(legacy, trio, MON, 'all', TUE).state,
    'overdue',
    'no startDate means no lower bound'
  );
}

{
  const weekly = makeChore({
    frequency: 'weekly',
    anchorDate: normalizeDay(TUE).toISOString(),
    startDate: normalizeDay(TUE).toISOString()
  });
  // The occurrence a week earlier lines up with the anchor but predates the
  // chore, so it is not an occurrence at all.
  assert.equal(buildScheduleCell(weekly, trio, shiftDays(TUE, -7), 'all', TUE).state, 'none');
  assert.equal(buildScheduleCell(weekly, trio, shiftDays(TUE, 7), 'all', TUE).state, 'open');
}

// --- Carrying an unfinished turn forward ------------------------------------

{
  // Nothing recorded for Sunday or Monday, so both are still owed on Tuesday.
  const chore = makeChore();
  const missed = missedOccurrences(chore, trio, TUE, TUE, 2);
  assert.deepEqual(
    missed.map(c => c.key),
    [dayKey(MON), dayKey(shiftDays(TUE, -2))],
    'missed days come back most recent first'
  );
  assert.ok(
    missed.every(c => c.state === 'overdue'),
    'and only ever contain days that are genuinely open'
  );
}

{
  // Which days are outstanding depends only on the schedule and what was
  // recorded, never on who the pointer happens to name, so the badge counts the
  // same days no matter when it is rendered.
  const chore = makeChore();
  const fromTue = missedOccurrences(chore, trio, TUE, TUE, 3).map(c => c.key);
  const fromWed = missedOccurrences(chore, trio, TUE, WED, 3).map(c => c.key);
  assert.deepEqual(fromTue, fromWed, 'the set of outstanding days does not drift with today');
}

{
  const done = makeChore({
    completions: { [dayKey(MON)]: { userId: 'u1', at: MON.toISOString() } }
  });
  assert.deepEqual(
    missedOccurrences(done, trio, TUE, TUE, 1).map(c => c.key),
    [],
    'a completed day is settled, not outstanding'
  );
}

{
  // A skip passes the turn to the next resident but leaves the day itself open,
  // so the work is still owed. Skipping is therefore not a way to write a
  // missed day off, which is why nothing here can clear one.
  const skipped = makeChore({
    completions: { [dayKey(MON)]: { userId: 'u1', at: MON.toISOString(), skipped: true } }
  });
  assert.deepEqual(
    missedOccurrences(skipped, trio, TUE, TUE, 1).map(c => c.key),
    [dayKey(MON)],
    'a skipped day is reassigned, not settled'
  );
}

// --- Writing a missed day off ----------------------------------------------

{
  // Closing a day that was never done takes it out of the outstanding list
  // without ever claiming it was completed.
  const closed = makeChore({
    completions: { [dayKey(MON)]: { userId: 'u1', at: MON.toISOString(), cancelled: true } }
  });
  const cell = buildScheduleCell(closed, trio, MON, 'all', TUE);
  assert.equal(cell.state, 'cancelled', 'the day reads as closed, not as done or overdue');
  assert.equal(cell.userId, 'u1', 'and stays pinned to whoever owed it');
  assert.equal(cell.assignment?.done, false, 'a closed day was never completed');
  assert.deepEqual(
    missedOccurrences(closed, trio, TUE, TUE, 1).map(c => c.key),
    [],
    'and stops being carried forward'
  );
}

{
  // Closing a day must not be mistaken for a completion by the health
  // indicator, which reads the denormalised markers.
  const closed = { [dayKey(MON)]: { userId: 'u1', at: MON.toISOString(), cancelled: true } };
  assert.deepEqual(
    completionMarkers(closed),
    { lastCompletedAt: null, lastCompletedLogId: null },
    'a closed day does not count as the last completion'
  );
}

{
  // A weekly chore rolls to its next occurrence, never to the following day, so
  // the days in between are not debts it accumulated.
  const weekly = makeChore({ frequency: 'weekly', anchorDate: normalizeDay(MON).toISOString() });
  const nextMonday = shiftDays(MON, 7);
  const missed = missedOccurrences(weekly, trio, nextMonday, nextMonday, 7);
  assert.deepEqual(
    missed.map(c => c.key),
    [dayKey(MON)],
    'one missed occurrence, not seven missed days'
  );
}

{
  // A day the whole household was away is nobody's debt to carry.
  const away = trio.map(u => ({ ...u, isAbsent: true }));
  assert.deepEqual(missedOccurrences(makeChore(), away, TUE, TUE, 3), [], 'unavailable is not owed');
}

// --- The day selector reaching the day being shown --------------------------

{
  // Ordinary use is unchanged: while the selection is near today the strip
  // stays put, so it does not shuffle under the user on every tap.
  assert.deepEqual(
    dayStripDays(TUE, TUE).map(dayKey),
    Array.from({ length: 11 }, (_, i) => dayKey(shiftDays(TUE, i - 3))),
    'selecting today leaves the window anchored at today-3..today+7'
  );
  assert.deepEqual(
    dayStripDays(TUE, shiftDays(TUE, 7)).map(dayKey),
    dayStripDays(TUE, TUE).map(dayKey),
    'and the last day inside the window does not move it'
  );
}

{
  // The invariant that was broken. The strip is the only place the day view
  // names its date, so a selection missing from it left the user reading tasks
  // for an unlabelled day, where marking one done backdates the completion.
  // Aug 22 2026 is a Saturday, when the current week's Sunday is six days back
  // and so outside a window fixed to today-3. Tapping that column in the week
  // grid needs no navigation at all to reproduce the bug.
  const SAT = new Date(2026, 7, 22, 12, 0, 0);
  const jumps: [string, Date, Date][] = [
    ['the week arrows, one week back', TUE, shiftDays(TUE, -7)],
    ['the week arrows, several weeks on', TUE, shiftDays(TUE, 21)],
    ['the carry-over badge at its furthest reach', TUE, shiftDays(TUE, -MISSED_LOOKBACK_DAYS)],
    ["this week's Sunday, tapped on a Saturday", SAT, shiftDays(SAT, -SAT.getDay())]
  ];
  for (const [via, today, selected] of jumps) {
    assert.ok(
      dayStripDays(today, selected).some(d => dayKey(d) === dayKey(selected)),
      `the selected day is still on the strip after ${via}`
    );
  }
}

{
  // A jump lands centred rather than pinned to an edge, so the days either side
  // of the target can be reached without another jump.
  const target = shiftDays(TUE, -14);
  const strip = dayStripDays(TUE, target).map(dayKey);
  assert.equal(strip.indexOf(dayKey(target)), 5, 'an out-of-range selection sits mid-strip');
}

{
  const strip = dayStripDays(TUE, shiftDays(TUE, -30));
  assert.equal(strip.length, 11, 'the strip is always the same width');
  assert.equal(new Set(strip.map(dayKey)).size, 11, 'with no repeated day');
  for (let i = 1; i < strip.length; i++) {
    assert.equal(
      dayKey(strip[i]),
      dayKey(shiftDays(strip[i - 1], 1)),
      'and runs forwards one day at a time'
    );
  }
}

console.log('schedule-view tests passed');
