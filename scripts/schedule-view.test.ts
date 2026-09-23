import assert from 'node:assert/strict';
import {
  HANDED_ON,
  MISSED_LOOKBACK_DAYS,
  buildScheduleCell,
  buildScheduleRows,
  carryOverLabel,
  dayStripDays,
  dropTargets,
  isHandedOn,
  isPickable,
  missedOccurrences,
  relativeDayLabel,
  statePresentation,
  weekAround,
  shiftDays
} from '../lib/schedule-view';
import type { ScheduleFilters } from '../lib/schedule-view';
import {
  completionMarkers,
  dayKey,
  normalizeDay,
  withMovedOccurrence,
  withSwappedDays
} from '../lib/rotation';
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
  // What the grid draws across a run of missed days. The pointer moves only
  // when somebody records something, so one resident holds the whole run and
  // today's column names them too. Projected backwards from today these landed
  // on a different resident every column, and on different ones again the next
  // morning, so the week read as a rota nobody recognised instead of as a debt.
  const chore = makeChore({ currentIndex: 1 });
  const FRI = shiftDays(TUE, 3);
  const [row] = buildScheduleRows([chore], trio, weekAround(FRI), ALL, FRI);

  const late = row.cells.filter(c => c.state === 'overdue');
  assert.ok(late.length >= 3, 'the week holds a run of missed days worth comparing');
  assert.deepEqual(
    [...new Set(late.map(c => c.userId))],
    ['u2'],
    'the whole run is owed by the one resident who never passed the turn on'
  );
  assert.equal(
    row.cells.find(c => c.key === dayKey(FRI))?.userId,
    'u2',
    "and today's column names them as well, so the debt and the turn agree"
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
    ["this week's Sunday, tapped on a Saturday", SAT, shiftDays(SAT, -SAT.getDay())],
    // The strip's own arrows shift the selection a week, and reaching a distant
    // date means pressing one of them several times. Each press re-anchors from
    // where the last one left the selection, so a repeated press has to keep
    // landing on the strip as much as the first one does.
    ['the strip arrows, pressed back four times', TUE, shiftDays(TUE, -28)],
    ['the strip arrows, pressed forward four times', TUE, shiftDays(TUE, 28)]
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

// --- Rearranging days -------------------------------------------------------

{
  // Mondays, Wednesdays and Fridays, so the week has both kinds of target.
  const mwf = makeChore({ frequency: 'custom_days', customDays: [1, 3, 5] });
  const week = weekAround(TUE);
  const wedIndex = week.findIndex(d => dayKey(d) === dayKey(WED));

  const cells = week.map(day => buildScheduleCell(mwf, trio, day, 'all', MON));
  assert.equal(isPickable(cells[wedIndex]), true, 'an open day can be picked up');

  const targets = dropTargets(mwf, trio, week, wedIndex, MON);
  const kindAt = (day: Date) =>
    targets.find(t => dayKey(week[t.index]) === dayKey(day))?.kind ?? null;

  assert.equal(kindAt(new Date(2026, 7, 20)), 'move', 'an empty Thursday is somewhere to move to');
  assert.equal(kindAt(new Date(2026, 7, 17)), 'swap', "another resident's Monday is a trade");
  assert.equal(kindAt(new Date(2026, 7, 21)), 'swap', 'as is their Friday');
  assert.equal(kindAt(WED), null, 'a day cannot be dropped on itself');
}

{
  // Nothing to reschedule once the day is settled.
  const week = weekAround(TUE);
  const wedIndex = week.findIndex(d => dayKey(d) === dayKey(WED));

  const done = makeChore({ completions: { [dayKey(WED)]: { userId: 'u1', at: WED.toISOString() } } });
  assert.deepEqual(dropTargets(done, trio, week, wedIndex, MON), [], 'a finished day cannot be picked up');

  const cancelled = makeChore({
    completions: { [dayKey(WED)]: { userId: 'u1', at: WED.toISOString(), cancelled: true } }
  });
  assert.deepEqual(dropTargets(cancelled, trio, week, wedIndex, MON), [], 'nor can a written-off one');
}

{
  // The chore did not exist for part of the week on screen.
  const week = weekAround(TUE);
  const friIndex = week.findIndex(d => dayKey(d) === dayKey(new Date(2026, 7, 21)));
  const late = makeChore({
    frequency: 'custom_days',
    customDays: [1, 3, 5],
    startDate: new Date(2026, 7, 19).toISOString()
  });
  const targets = dropTargets(late, trio, week, friIndex, WED);
  assert.ok(
    targets.every(t => normalizeDay(week[t.index]).getTime() >= normalizeDay(WED).getTime()),
    'no day before the chore existed is offered, the same rule the schedule already applies'
  );
}

{
  // A day the occurrence was moved off renders empty, but it is not free.
  const mwf = makeChore({ frequency: 'custom_days', customDays: [1, 3, 5] });
  const week = weekAround(TUE);
  const moved = { ...mwf, completions: withMovedOccurrence(mwf, WED, new Date(2026, 7, 20), 'u2', MON) };

  const wedCell = buildScheduleCell(moved, trio, WED, 'all', MON);
  assert.equal(wedCell.state, 'none', 'the day it left drops out of the grid');

  const thuIndex = week.findIndex(d => dayKey(d) === dayKey(new Date(2026, 7, 20)));
  const thuCell = buildScheduleCell(moved, trio, week[thuIndex], 'all', MON);
  assert.equal(thuCell.state, 'open', 'and the day it landed on takes its place');
  assert.equal(thuCell.movedFrom, dayKey(WED), 'which the grid can say so the date is not a mystery');
  assert.equal(thuCell.rearranged, true, 'and is flagged as not simply whose turn it was');

  const monIndex = week.findIndex(d => dayKey(d) === dayKey(MON));
  const targets = dropTargets(moved, trio, week, monIndex, MON);
  assert.equal(
    targets.some(t => dayKey(week[t.index]) === dayKey(WED)),
    false,
    'the vacated day is not offered as free space, which would relocate onto a suppressed day'
  );
}

{
  // A swap leaves both days in place and both flagged.
  const daily = makeChore();
  const swapped = { ...daily, completions: withSwappedDays(daily, MON, 'u1', WED, 'u3', MON) };

  const mon = buildScheduleCell(swapped, trio, MON, 'all', MON);
  const wed = buildScheduleCell(swapped, trio, WED, 'all', MON);
  assert.equal(mon.userId, 'u3', 'Monday shows who took it');
  assert.equal(wed.userId, 'u1', 'and Wednesday who traded for it');
  assert.equal(mon.rearranged, true, 'both are marked as arranged rather than dealt');
  assert.equal(wed.rearranged, true);
  assert.equal(mon.movedFrom, null, 'a swap moves nobody, so there is no origin to name');

  assert.equal(
    buildScheduleCell(swapped, trio, TUE, 'all', MON).userId,
    'u2',
    'and the day between them is untouched, exactly as the day list shows it'
  );
}

{
  // Copy aimed at a resident. A date is only reached once a weekday name would
  // stop saying which week it meant.
  assert.equal(relativeDayLabel(TUE, TUE), 'מהיום', 'today is named, not dated');
  assert.equal(relativeDayLabel(MON, TUE), 'מאתמול', 'and so is yesterday');

  const saturday = new Date(2026, 7, 15, 12, 0, 0);
  assert.equal(
    relativeDayLabel(saturday, TUE),
    'מיום שבת',
    'inside the week the weekday alone places the day'
  );

  const lastWeek = new Date(2026, 7, 10, 12, 0, 0);
  assert.equal(
    relativeDayLabel(lastWeek, TUE).startsWith('מיום'),
    false,
    'past a week a weekday no longer says which week, so it falls back to the date'
  );
}

{
  // What the carry-over line on today's card says.
  const daily = makeChore();

  const slippedOnce = missedOccurrences(daily, trio, TUE, TUE, 1);
  assert.equal(slippedOnce.length, 1, 'one day back, one day owed');
  assert.equal(
    carryOverLabel(slippedOnce, TUE),
    'נדחה מאתמול',
    'a single slip is dated in words a resident would use'
  );

  const slippedThrice = missedOccurrences(daily, trio, TUE, TUE, 3);
  assert.equal(slippedThrice.length, 3, 'three days back, three owed');
  assert.equal(
    carryOverLabel(slippedThrice, TUE),
    'נדחה 3 פעמים',
    'repeated slips are counted, since that is the thing worth noticing'
  );
}

// --- Dragging reschedules work, it does not rewrite history ------------------

{
  // A source may be in the past - moving an unpaid debt forward is the main
  // reason dragging exists - but a target may not. An occurrence used to be
  // droppable onto a day that had already gone, and two past days could be
  // traded with each other.
  const week = weekAround(TUE);
  const chore = makeChore({ frequency: 'daily' });
  const tuesdayIndex = week.findIndex(d => dayKey(d) === dayKey(TUE));
  const mondayIndex = week.findIndex(d => dayKey(d) === dayKey(MON));

  const fromToday = dropTargets(chore, trio, week, tuesdayIndex, TUE);
  assert.ok(fromToday.length > 0, 'today can still be moved somewhere');
  for (const t of fromToday) {
    assert.ok(
      normalizeDay(week[t.index]).getTime() >= normalizeDay(TUE).getTime(),
      'no target is a day that has already gone'
    );
  }

  const fromOverdue = dropTargets(chore, trio, week, mondayIndex, TUE);
  assert.ok(
    fromOverdue.length > 0,
    'an overdue day can still be picked up, which is the point of dragging'
  );
  assert.ok(
    !fromOverdue.some(t => t.index === mondayIndex),
    'and cannot be dropped on itself'
  );
  for (const t of fromOverdue) {
    assert.ok(
      normalizeDay(week[t.index]).getTime() >= normalizeDay(TUE).getTime(),
      'a debt moves forward onto a day somebody can do it, never further back'
    );
  }
}

{
  // Moving an occurrence off a day leaves a `movedTo` marker behind. The day
  // then has no occurrence, so it resolves to `none` - and looked exactly like
  // a day the chore never fell on, which made it read as free space in the
  // grid while `dropTargets` silently refused every drop onto it.
  const week = weekAround(TUE);
  const wedIndex = week.findIndex(d => dayKey(d) === dayKey(WED));
  const thu = shiftDays(WED, 1);
  const thuIndex = week.findIndex(d => dayKey(d) === dayKey(thu));

  const daily = makeChore({ frequency: 'daily' });
  const afterMove = makeChore({
    frequency: 'daily',
    completions: withMovedOccurrence(daily, WED, thu, 'u1', TUE)
  });

  const vacated = buildScheduleCell(afterMove, trio, WED, 'all', TUE);
  assert.equal(vacated.state, 'none', 'the day it left has no occurrence, as before');
  assert.equal(
    vacated.vacatedTo,
    dayKey(thu),
    'but it can now say where the occurrence went, so it need not look free'
  );

  const landed = buildScheduleCell(afterMove, trio, thu, 'all', TUE);
  assert.equal(landed.movedFrom, dayKey(WED), 'and the day it landed on says where from');
  assert.equal(landed.vacatedTo, null, 'a day holding an occurrence has not been vacated');

  // The refusal itself is deliberate and stays; it is being drawn that changes.
  const targets = dropTargets(afterMove, trio, week, thuIndex, TUE);
  assert.ok(
    !targets.some(t => t.index === wedIndex),
    'the vacated day is still refused, because landing there would leave it both suppressed and relocated onto'
  );

  const plain = buildScheduleCell(daily, trio, WED, 'all', TUE);
  assert.equal(plain.vacatedTo, null, 'a day with a live occurrence reports no vacancy');
}

// --- How a state looks ------------------------------------------------------
//
// One table decides this for every view, so these assert the distinctions a
// resident has to be able to make at a glance. Each was a real confusion: the
// four blocks below are the four ways the old per-view styling lied.

{
  // `open` was styled byte-identically to `none`, so the state that describes
  // almost every card carried no signal at all.
  const open = statePresentation('open');
  const none = statePresentation('none');
  assert.notEqual(open.surface, none.surface, 'a task to do does not look like a day off');
  assert.notEqual(open.glyph, none.glyph, 'and says so by shape, not only by tint');
  assert.equal(open.owed, true, 'an open day is owed');
}

{
  // `cancelled` and `unavailable` shared a surface while meaning opposite
  // things: one is a decision somebody made, the other is the app reporting it
  // has nobody to ask.
  const cancelled = statePresentation('cancelled');
  const unavailable = statePresentation('unavailable');
  assert.notEqual(
    cancelled.surface,
    unavailable.surface,
    'writing a day off does not look like having nobody to give it to'
  );
  assert.notEqual(cancelled.glyph, unavailable.glyph, 'and differs by shape too');
  assert.equal(cancelled.settled, true, 'a written-off day is settled');
  assert.equal(
    unavailable.owed,
    false,
    'an unavailable day is owed by nobody, so it must not read as a debt'
  );
  assert.equal(
    unavailable.settled,
    false,
    'but it is not settled either - nothing about it was decided'
  );
}

{
  // Settled versus owed is the first distinction the eye should make, so it is
  // the one thing every caller can branch on without knowing the state names.
  const settled = (['done', 'cancelled'] as const).map(s => statePresentation(s).settled);
  assert.deepEqual(settled, [true, true], 'done and written off are the settled pair');
  const owed = (['open', 'overdue'] as const).map(s => statePresentation(s).owed);
  assert.deepEqual(owed, [true, true], 'open and overdue are the owed pair');
}

{
  // A skip hands the turn on and leaves the day owed, so it is a modifier on a
  // state rather than a state. It used to be the faintest text on the card and
  // was absent from the grid entirely.
  const skipped = makeChore({
    completions: { [dayKey(TUE)]: { userId: 'u1', at: TUE.toISOString(), skipped: true } },
    currentIndex: 1
  });

  const today = buildScheduleCell(skipped, trio, TUE, 'all', TUE);
  assert.equal(today.state, 'open', 'a skipped day is still open, because it is still owed');
  assert.equal(isHandedOn(today), true, 'and is drawable as handed on');

  const yesterday = buildScheduleCell(
    makeChore({
      completions: { [dayKey(MON)]: { userId: 'u1', at: MON.toISOString(), skipped: true } },
      currentIndex: 1
    }),
    trio,
    MON,
    'all',
    TUE
  );
  assert.equal(yesterday.state, 'overdue', 'a skipped day that has passed is late as well');
  assert.equal(
    isHandedOn(yesterday),
    true,
    'being late does not stop it having been handed on - the card needs to say both'
  );

  const done = buildScheduleCell(
    makeChore({ completions: { [dayKey(TUE)]: { userId: 'u1', at: TUE.toISOString() } } }),
    trio,
    TUE,
    'all',
    TUE
  );
  assert.equal(isHandedOn(done), false, 'a finished day was not handed to anybody');
}

{
  // Every state needs a label and a glyph, or a view will quietly fall back to
  // inventing its own vocabulary - which is how the grid's legend came to
  // disagree with the grid.
  const states = ['none', 'open', 'overdue', 'done', 'cancelled', 'unavailable'] as const;
  const labels = states.map(s => statePresentation(s).label);
  assert.equal(new Set(labels).size, states.length, 'every state has its own words');
  for (const s of states) {
    const p = statePresentation(s);
    assert.ok(p.label.length > 0, `${s} has a label`);
    assert.ok(p.surface.length > 0 && p.badge.length > 0 && p.dot.length > 0, `${s} is drawable`);
    assert.equal(p.settled && p.owed, false, `${s} cannot be both settled and owed`);
  }
  assert.notEqual(
    HANDED_ON.label,
    statePresentation('open').label,
    'handing a turn on is its own thing to say'
  );
}

{
  // A lookup, not a constructor: this runs once per rendered cell and a week
  // grid is chores times seven cells wide.
  assert.equal(
    statePresentation('overdue'),
    statePresentation('overdue'),
    'the same state resolves to the very same object, allocating nothing'
  );
}

// --- What a pass over the schedule is allowed to cost -----------------------
//
// Resolving one cell walks the calendar from today to the day in question and
// consults the rotation at every occurrence on the way. That made the cost of a
// week grid proportional to the size of the household as well, because each
// consultation searched the resident array. It is a lookup, so these assert it
// is one: `Residents` accepts an index, every entry point builds it at most
// once per pass, and a household that grows does not make the grid slower per
// resident.
//
// A budget nobody checks is a wish, which is why this counts rather than times.

class CountingIndex extends Map<string, RotationUser> {
  lookups = 0;
  override get(id: string) {
    this.lookups++;
    return super.get(id);
  }
}

const countingTrio = () => new CountingIndex(trio.map(u => [u.id, u] as const));

{
  // The index is handed through, not rebuilt. Were any layer to call
  // `indexUsers` on an array it had made itself, the count below would be zero
  // because the copy would absorb the lookups.
  const index = countingTrio();
  const rows = buildScheduleRows([makeChore()], index, weekAround(TUE), ALL, TUE);
  assert.equal(rows.length, 1, 'a daily chore occupies the whole week');
  assert.ok(
    index.lookups > 0,
    'the index the caller passed is the one consulted, not a copy of it'
  );
}

{
  // The same schedule, asked for through both shapes, has to agree. Accepting
  // two shapes is only safe while it cannot change an answer.
  const week = weekAround(TUE);
  const chore = makeChore({
    completions: { [dayKey(MON)]: { userId: 'u1', at: MON.toISOString() } }
  });
  const viaArray = buildScheduleRows([chore], trio, week, ALL, TUE);
  const viaIndex = buildScheduleRows([chore], countingTrio(), week, ALL, TUE);
  assert.deepEqual(
    viaIndex[0].cells.map(c => [c.state, c.userId]),
    viaArray[0].cells.map(c => [c.state, c.userId]),
    'an array and an index describe the same week'
  );
}

{
  // The budget itself. Lookups should scale with the work — cells, and the
  // occurrences each cell walks past — and not with the number of residents,
  // which is the factor the array search added.
  const week = weekAround(TUE);
  const chores = Array.from({ length: 10 }, (_, i) => makeChore({ id: `c${i}` }));

  const small = new CountingIndex(trio.map(u => [u.id, u] as const));
  buildScheduleRows(chores, small, week, ALL, TUE);

  const crowd = Array.from({ length: 12 }, (_, i) => present(`x${i}`));
  const large = new CountingIndex(
    [...trio, ...crowd].map(u => [u.id, u] as const)
  );
  buildScheduleRows(chores, large, week, ALL, TUE);

  assert.ok(small.lookups > 0, 'the grid does consult the rotation, so this measures something');
  assert.equal(
    large.lookups,
    small.lookups,
    'quadrupling the household does not cost the grid a single extra lookup'
  );
}

console.log('schedule-view tests passed');
