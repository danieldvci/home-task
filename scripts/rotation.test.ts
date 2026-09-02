import assert from 'node:assert/strict';
import {
  choreOccursOnDate,
  completionMarkers,
  currentIndexAfterUndo,
  dayKey,
  getActiveAssigneeIndex,
  getNextActiveIndex,
  getOccurrencesBetween,
  getPrevActiveIndex,
  isDoneOnDay,
  isEveryoneAwayOnDay,
  isUserAbsentNow,
  isUserAbsentOnDay,
  listOccurrenceDates,
  projectAssigneeIndex,
  resolveDayAssignee,
  withCompletion,
  withMovedOccurrence,
  withoutCompletion,
  withoutRearrangement,
  withSwappedDays
} from '../lib/rotation';
import type { Chore, RotationUser } from '../lib/rotation';

// Aug 18 2026 is a Tuesday.
const TUE = new Date(2026, 7, 18, 12, 0, 0);
const WED = new Date(2026, 7, 19, 12, 0, 0);
const THU = new Date(2026, 7, 20, 12, 0, 0);
const FRI = new Date(2026, 7, 21, 12, 0, 0);
const MON = new Date(2026, 7, 17, 12, 0, 0);

const at = (base: Date, hours: number) => {
  const d = new Date(base);
  d.setHours(hours, 0, 0, 0);
  return d;
};

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

// --- Rotation basics -------------------------------------------------------

{
  const legacy = [present('u1'), { id: 'u2', isAbsent: true }, present('u3')];
  assert.equal(getActiveAssigneeIndex(makeChore(), legacy, 1, TUE), 2, 'skips an absent assignee');
  assert.equal(getActiveAssigneeIndex(makeChore({ rotation: [] }), trio, 0, TUE), -1, 'empty rotation');
  assert.equal(
    getActiveAssigneeIndex(makeChore({ rotation: ['ghost', 'u3'] }), trio, 0, TUE),
    1,
    'a rotation id with no profile is skipped'
  );
  assert.equal(getNextActiveIndex(makeChore(), trio, 2, TUE), 0, 'next wraps around');
  assert.equal(getPrevActiveIndex(makeChore(), trio, 0, TUE), 2, 'prev wraps around');
}

// --- Occurrences -----------------------------------------------------------

{
  assert.equal(getOccurrencesBetween(makeChore(), TUE, WED), 1, 'daily, one day ahead');
  assert.equal(getOccurrencesBetween(makeChore(), TUE, TUE), 0, 'same day');
  assert.equal(getOccurrencesBetween(makeChore(), THU, TUE), -2, 'past days count negative');

  const customDays = makeChore({ frequency: 'custom_days', customDays: [4] });
  assert.equal(getOccurrencesBetween(customDays, TUE, THU), 1, 'custom_days counts only Thursday');
  assert.deepEqual(
    listOccurrenceDates(customDays, TUE, FRI).map(dayKey),
    [dayKey(THU)],
    'occurrence dates are returned, not just a count'
  );

  const weekly = makeChore({ frequency: 'weekly' });
  assert.equal(getOccurrencesBetween(weekly, TUE, THU), 0, 'weekly does not occur mid-week');
}

// --- Absence windows -------------------------------------------------------

{
  const legacyAbsent = { id: 'u2', isAbsent: true };
  assert.equal(isUserAbsentOnDay(legacyAbsent, TUE), true, 'legacy flag applies to every day');
  assert.equal(isUserAbsentOnDay(legacyAbsent, FRI), true);

  const wedOnly = { id: 'u2', isAbsent: false, absentFrom: at(WED, 8).toISOString(), absentUntil: at(WED, 20).toISOString() };
  assert.equal(isUserAbsentOnDay(wedOnly, TUE), false, 'window does not leak into the previous day');
  assert.equal(isUserAbsentOnDay(wedOnly, WED), true, 'window covers its own day');
  assert.equal(isUserAbsentOnDay(wedOnly, THU), false, 'window does not leak into the next day');
  assert.equal(isUserAbsentNow(wedOnly, at(WED, 12)), true, 'inside the window');
  assert.equal(isUserAbsentNow(wedOnly, at(WED, 21)), false, 'after the window');
  assert.equal(isUserAbsentNow(wedOnly, at(WED, 7)), false, 'before the window');

  const openEnded = { id: 'u2', isAbsent: true, absentFrom: at(WED, 8).toISOString(), absentUntil: null };
  assert.equal(isUserAbsentOnDay(openEnded, TUE), false, 'open-ended absence has not started yet');
  assert.equal(isUserAbsentOnDay(openEnded, WED), true);
  assert.equal(isUserAbsentOnDay(openEnded, FRI), true, 'open-ended absence never expires');

  const untilOnly = { id: 'u2', isAbsent: true, absentFrom: null, absentUntil: at(WED, 8).toISOString() };
  assert.equal(isUserAbsentOnDay(untilOnly, MON), true, 'open start covers earlier days');
  assert.equal(isUserAbsentOnDay(untilOnly, THU), false);

  // The stale mirror must not win over a window that has already ended.
  const expired = { id: 'u2', isAbsent: true, absentFrom: at(MON, 8).toISOString(), absentUntil: at(MON, 20).toISOString() };
  assert.equal(isUserAbsentOnDay(expired, TUE), false, 'expired window beats the isAbsent mirror');
}

// --- Per-day projection ----------------------------------------------------

{
  const chore = makeChore();
  const users = [
    present('u1'),
    { id: 'u2', isAbsent: false, absentFrom: at(WED, 0).toISOString(), absentUntil: at(WED, 23).toISOString() },
    present('u3')
  ];

  assert.equal(projectAssigneeIndex(chore, users, 0, TUE, TUE), 0, 'today keeps the pointer');
  assert.equal(projectAssigneeIndex(chore, users, 0, TUE, WED), 2, 'Wednesday skips the absent resident');
  assert.equal(projectAssigneeIndex(chore, users, 0, TUE, THU), 0, 'Thursday continues past the skip');
  // Marking someone absent for one day must not rewrite any other day.
  const withoutAbsence = projectAssigneeIndex(chore, trio, 0, TUE, THU);
  assert.equal(withoutAbsence, 2, 'without the window Thursday belongs to the third resident');
}

// --- Completion freezes the day to its completer ---------------------------

{
  // u1 completed Tuesday, so the pointer has already moved on to u2.
  const completions = { [dayKey(TUE)]: { userId: 'u1', logId: 'l1', at: TUE.toISOString() } };
  const chore = makeChore({
    currentIndex: 1,
    completions,
    ...completionMarkers(completions)
  });

  const tuesday = resolveDayAssignee(chore, trio, TUE, TUE);
  assert.equal(tuesday.done, true, 'the completed day reads as done');
  assert.equal(tuesday.userId, 'u1', 'the completed day stays with the person who did it');
  assert.equal(tuesday.completedBy, 'u1');
  assert.equal(tuesday.logId, 'l1');
  assert.equal(tuesday.inferred, false);

  const wednesday = resolveDayAssignee(chore, trio, WED, TUE);
  assert.equal(wednesday.done, false, 'the next day is still open');
  assert.equal(wednesday.userId, 'u2', 'the next day belongs to the next resident');

  assert.equal(isDoneOnDay(chore, TUE), true, 're-completing Tuesday is blocked');
  assert.equal(isDoneOnDay(chore, WED), false);

  const monday = resolveDayAssignee(chore, trio, MON, TUE);
  assert.equal(monday.userId, 'u3', 'past days step back from the completer, not the advanced pointer');

  // An occurrence completed ahead of time is frozen and takes no turn from the
  // days around it.
  const earlyThursday = {
    ...completions,
    [dayKey(THU)]: { userId: 'u1', logId: 'l3', at: TUE.toISOString() }
  };
  const preCompleted = makeChore({ currentIndex: 1, completions: earlyThursday });
  assert.equal(resolveDayAssignee(preCompleted, trio, WED, TUE).userId, 'u2', 'Wednesday is unaffected');
  assert.equal(resolveDayAssignee(preCompleted, trio, THU, TUE).userId, 'u1', 'Thursday stays frozen');
  assert.equal(resolveDayAssignee(preCompleted, trio, FRI, TUE).userId, 'u2', 'Friday follows the frozen day');

  // The state conflict: u1 is marked absent after completing.
  const absentCompleter = [
    { id: 'u1', isAbsent: true, absentFrom: at(TUE, 15).toISOString(), absentUntil: null },
    present('u2'),
    present('u3')
  ];
  const afterAbsence = resolveDayAssignee(chore, absentCompleter, TUE, TUE);
  assert.equal(afterAbsence.userId, 'u1', 'an absence cannot reassign an already completed day');
  assert.equal(afterAbsence.done, true);
  assert.equal(
    resolveDayAssignee(chore, absentCompleter, THU, TUE).userId,
    'u3',
    'open days still skip the absent resident'
  );
}

// --- Legacy documents ------------------------------------------------------

{
  // Written before `completions` existed: the day is known done, the completer
  // is inferred from the pointer.
  const legacy = makeChore({ currentIndex: 1, lastCompletedAt: TUE.toISOString(), lastCompletedLogId: 'l9' });
  const resolved = resolveDayAssignee(legacy, trio, TUE, TUE);
  assert.equal(resolved.done, true, 'legacy marker still marks the day done');
  assert.equal(resolved.inferred, true);
  assert.equal(resolved.completedBy, 'u1', 'legacy completer is the resident before the pointer');
  assert.equal(resolved.logId, 'l9');

  // Once a map exists it is the only source of truth, so a stale marker for a
  // different day cannot resurrect a phantom completion.
  const migrated = makeChore({
    currentIndex: 1,
    lastCompletedAt: THU.toISOString(),
    completions: { [dayKey(TUE)]: { userId: 'u1', logId: 'l1', at: TUE.toISOString() } }
  });
  assert.equal(isDoneOnDay(migrated, THU), false, 'stale marker is ignored once the map is populated');
  assert.equal(isDoneOnDay(migrated, TUE), true);
}

// --- Map writers -----------------------------------------------------------

{
  const chore = makeChore();
  const afterTue = withCompletion(chore, TUE, { userId: 'u1', logId: 'l1', at: TUE.toISOString() }, TUE);
  const afterWed = withCompletion({ ...chore, completions: afterTue }, WED, { userId: 'u2', logId: 'l2', at: WED.toISOString() }, WED);
  assert.deepEqual(Object.keys(afterWed).sort(), [dayKey(TUE), dayKey(WED)]);

  const markers = completionMarkers(afterWed);
  assert.equal(markers.lastCompletedLogId, 'l2', 'markers follow the newest entry');
  assert.equal(dayKey(new Date(markers.lastCompletedAt as string)), dayKey(WED));

  const undone = withoutCompletion({ ...chore, completions: afterWed }, WED, WED);
  assert.deepEqual(Object.keys(undone), [dayKey(TUE)]);
  assert.equal(completionMarkers(undone).lastCompletedLogId, 'l1', 'markers fall back to the previous entry');
  assert.equal(completionMarkers({}).lastCompletedAt, null, 'an empty map clears the markers');

  // Entries beyond the retention window are dropped on the next write.
  const old = new Date(TUE.getTime() - 200 * 86400000);
  const stale = { [dayKey(old)]: { userId: 'u1', logId: 'l0', at: old.toISOString() } };
  const pruned = withCompletion({ ...chore, completions: stale }, TUE, { userId: 'u1', logId: 'l1', at: TUE.toISOString() }, TUE);
  assert.deepEqual(Object.keys(pruned), [dayKey(TUE)], 'entries older than the retention window are pruned');
}

// --- Weekly chores repeat from their anchor, not from today ----------------

{
  const anchored = makeChore({ frequency: 'weekly', anchorDate: MON.toISOString() });
  const nextMon = new Date(2026, 7, 24, 12, 0, 0);

  assert.equal(choreOccursOnDate(anchored, MON, THU), true, 'the anchor day itself occurs');
  assert.equal(choreOccursOnDate(anchored, TUE, TUE), false, 'a weekly chore is not due every day');
  assert.equal(choreOccursOnDate(anchored, nextMon, TUE), true, 'it comes back seven days later');
  assert.deepEqual(
    listOccurrenceDates(anchored, TUE, new Date(2026, 8, 1, 12, 0, 0)).map(dayKey),
    [dayKey(nextMon), dayKey(new Date(2026, 7, 31, 12, 0, 0))],
    'occurrence days follow the anchor'
  );

  // Chores created before anchorDate existed keep a stable schedule by falling
  // back to their last completion.
  const byLastCompleted = makeChore({ frequency: 'weekly', lastCompletedAt: MON.toISOString() });
  assert.equal(choreOccursOnDate(byLastCompleted, MON, THU), true, 'falls back to the last completion');
  assert.equal(choreOccursOnDate(byLastCompleted, TUE, TUE), false);

  const unanchored = makeChore({ frequency: 'weekly' });
  assert.equal(choreOccursOnDate(unanchored, TUE, TUE), true, 'with nothing to anchor to, today is the anchor');

  // Consulting a weekly chore on an off day must not burn a turn: the next
  // occurrence still belongs to whoever the pointer names.
  assert.equal(
    resolveDayAssignee(anchored, trio, nextMon, TUE).userId,
    'u1',
    'the next weekly occurrence belongs to the current pointer'
  );
  assert.equal(
    resolveDayAssignee(anchored, trio, new Date(2026, 7, 31, 12, 0, 0), TUE).userId,
    'u2',
    'the occurrence after that moves one place on'
  );
}

// --- A skipped day is recorded, resolved, and not a completion -------------

{
  // The admin skipped u1 on Tuesday, so the pointer moved to u2 and Tuesday is
  // still open for u2.
  const completions = { [dayKey(TUE)]: { userId: 'u1', at: TUE.toISOString(), skipped: true } };
  const chore = makeChore({ currentIndex: 1, completions });

  const tuesday = resolveDayAssignee(chore, trio, TUE, TUE);
  assert.equal(tuesday.done, false, 'a skip is not a completion');
  assert.equal(tuesday.skippedBy, 'u1', 'the skipped resident is recorded');
  assert.equal(tuesday.userId, 'u2', 'the day passes to the next resident');
  assert.equal(isDoneOnDay(chore, TUE), false);

  assert.equal(resolveDayAssignee(chore, trio, WED, TUE).userId, 'u3', 'Wednesday carries on from the skip');
  assert.equal(
    completionMarkers(completions).lastCompletedAt,
    null,
    'a skip never counts as the last completion'
  );

  // Completing the skipped day afterwards overwrites the skip entry.
  const done = withCompletion(chore, TUE, { userId: 'u2', logId: 'l2', at: TUE.toISOString() }, TUE);
  const completed = makeChore({ currentIndex: 2, completions: done });
  assert.equal(resolveDayAssignee(completed, trio, TUE, TUE).done, true);
  assert.equal(resolveDayAssignee(completed, trio, TUE, TUE).completedBy, 'u2');
}

// --- Nobody available ------------------------------------------------------

{
  const chore = makeChore();
  const allAway = trio.map(u => ({
    ...u,
    absentFrom: at(WED, 0).toISOString(),
    absentUntil: at(WED, 23).toISOString()
  }));
  assert.equal(isEveryoneAwayOnDay(chore, allAway, WED), true, 'every resident is away');
  assert.equal(isEveryoneAwayOnDay(chore, allAway, TUE), false, 'the day before is fine');
  assert.equal(resolveDayAssignee(chore, allAway, WED, TUE).everyoneAway, true, 'the assignment says so');
  assert.equal(resolveDayAssignee(chore, trio, WED, TUE).everyoneAway, false);
  assert.equal(
    isEveryoneAwayOnDay(makeChore({ rotation: ['ghost'] }), trio, TUE),
    true,
    'a rotation member with no profile is not available either'
  );
  assert.equal(isEveryoneAwayOnDay(makeChore({ rotation: [] }), trio, TUE), false, 'an empty rotation is not "away"');
}

// --- Undo restores the turn only when nothing came after -------------------

{
  const tueOnly = { [dayKey(TUE)]: { userId: 'u1', logId: 'l1', at: TUE.toISOString() } };
  const chore = makeChore({ currentIndex: 1, completions: tueOnly });
  assert.equal(
    currentIndexAfterUndo(chore, TUE, 0, TUE),
    0,
    'undoing the newest completion hands the turn back to its completer'
  );

  // u1 did Tuesday and u2 did Wednesday; undoing Tuesday must not rewind past
  // Wednesday, or u3 would lose Thursday to u2 a second time.
  const bothDays = {
    ...tueOnly,
    [dayKey(WED)]: { userId: 'u2', logId: 'l2', at: WED.toISOString() }
  };
  const later = makeChore({ currentIndex: 2, completions: bothDays });
  assert.equal(
    currentIndexAfterUndo(later, TUE, 0, WED),
    2,
    'a later completion already defines the pointer'
  );
  assert.equal(
    currentIndexAfterUndo(later, WED, 1, WED),
    1,
    'undoing the newest of several still restores'
  );

  // A skip counts as a later record for the same reason.
  const skipAfter = makeChore({
    currentIndex: 2,
    completions: {
      ...tueOnly,
      [dayKey(WED)]: { userId: 'u2', at: WED.toISOString(), skipped: true }
    }
  });
  assert.equal(currentIndexAfterUndo(skipAfter, TUE, 0, WED), 2, 'a later skip counts too');

  // Completing a future day never moved the pointer, so undoing cannot move it.
  const future = makeChore({
    currentIndex: 1,
    completions: { [dayKey(THU)]: { userId: 'u1', logId: 'l3', at: TUE.toISOString() } }
  });
  assert.equal(currentIndexAfterUndo(future, THU, 0, TUE), 1, 'undoing a future day leaves the pointer');
}

// --- Undoing a skip --------------------------------------------------------

{
  // u1 was skipped on Tuesday, so the pointer sits on u2. Undoing that skip has
  // to drop the record and hand Tuesday back to u1.
  const chore = makeChore({
    currentIndex: 1,
    completions: { [dayKey(TUE)]: { userId: 'u1', at: TUE.toISOString(), skipped: true } }
  });
  const skippedBy = resolveDayAssignee(chore, trio, TUE, TUE).skippedBy!;
  const restoredIdx = chore.rotation.indexOf(skippedBy);
  const completions = withoutCompletion(chore, TUE, TUE);

  assert.equal(currentIndexAfterUndo(chore, TUE, restoredIdx, TUE), 0, 'the skipped resident gets the turn back');
  assert.equal(Object.keys(completions).length, 0, 'the skip record is gone');
  assert.equal(
    resolveDayAssignee({ ...chore, currentIndex: 0, completions }, trio, TUE, TUE).userId,
    'u1',
    'Tuesday is open for u1 again'
  );
}

// --- Swapping reads the viewed day, not today ------------------------------

{
  // The pointer is on u1 today, so a swap driven by `today` would always move
  // u1. Thursday belongs to u3, and that is who the card offers to swap.
  const chore = makeChore({ currentIndex: 0 });
  assert.equal(getActiveAssigneeIndex(chore, trio, chore.currentIndex, TUE), 0, 'today belongs to u1');
  assert.equal(resolveDayAssignee(chore, trio, THU, TUE).index, 2, 'Thursday belongs to u3');
}

// --- One-off tasks ---------------------------------------------------------

{
  const once = makeChore({
    id: 'c-once',
    frequency: 'once',
    onceDate: WED.toISOString(),
    rotation: ['u2'],
    currentIndex: 0
  });

  assert.equal(choreOccursOnDate(once, WED, TUE), true, 'a one-off occurs on its day');
  assert.equal(choreOccursOnDate(once, TUE, TUE), false, 'and on no other day');
  assert.equal(choreOccursOnDate(once, THU, THU), false, 'not even once its day has passed');
  assert.deepEqual(
    listOccurrenceDates(once, TUE, FRI).map(dayKey),
    [dayKey(WED)],
    'exactly one occurrence'
  );
  assert.equal(
    choreOccursOnDate(makeChore({ frequency: 'once' }), TUE, TUE),
    false,
    'a one-off with no day never occurs'
  );

  const day = resolveDayAssignee(once, trio, WED, TUE);
  assert.equal(day.userId, 'u2', 'the single rotation member owns it');
  assert.equal(day.done, false);

  // The regular completion path applies unchanged.
  const completed = {
    ...once,
    completions: withCompletion(once, WED, { userId: 'u2', logId: 'l7', at: WED.toISOString() }, WED)
  };
  const after = resolveDayAssignee(completed, trio, WED, TUE);
  assert.equal(after.done, true, 'it completes like any other chore');
  assert.equal(after.completedBy, 'u2');
}

// --- Freeze policy ---------------------------------------------------------
// Pinned per product decision: a completion belongs to whoever was recorded,
// undo is theirs (or an admin's), and undoing hands the turn back to them.

{
  const completions = { [dayKey(TUE)]: { userId: 'u1', logId: 'l1', at: TUE.toISOString() } };
  const chore = makeChore({ currentIndex: 1, completions, ...completionMarkers(completions) });

  // Reordering the rotation or moving the pointer cannot transfer the credit.
  const reordered = makeChore({ rotation: ['u3', 'u2', 'u1'], currentIndex: 0, completions });
  assert.equal(resolveDayAssignee(reordered, trio, TUE, TUE).completedBy, 'u1', 'credit survives a reorder');
  assert.equal(resolveDayAssignee(reordered, trio, TUE, TUE).index, 2, 'the index tracks the completer');

  // Undo restores the turn to the completer and reopens the day.
  const restored = makeChore({
    currentIndex: resolveDayAssignee(chore, trio, TUE, TUE).index,
    completions: withoutCompletion(chore, TUE, TUE)
  });
  const reopened = resolveDayAssignee(restored, trio, TUE, TUE);
  assert.equal(reopened.done, false, 'the day is open again');
  assert.equal(reopened.userId, 'u1', 'and the turn is back with the completer');
}

// --- Moving and swapping days ----------------------------------------------
// A dragged occurrence must not change how many turns the rotation hands out.
// Getting this wrong is silent: the grid looks right and one resident quietly
// gets two turns in a row.

const shiftDay = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

{
  // Mondays, Wednesdays and Fridays, so there are empty days to move onto.
  const mwf = makeChore({ frequency: 'custom_days', customDays: [1, 3, 5], currentIndex: 0 });
  assert.equal(resolveDayAssignee(mwf, trio, WED, MON).userId, 'u2', 'Wednesday is u2 to begin with');
  assert.equal(resolveDayAssignee(mwf, trio, FRI, MON).userId, 'u3', 'and Friday is u3');

  const moved = { ...mwf, completions: withMovedOccurrence(mwf, WED, THU, 'u2', MON) };

  assert.equal(choreOccursOnDate(moved, WED, MON), false, 'the day it left no longer occurs');
  assert.equal(choreOccursOnDate(moved, THU, MON), true, 'the day it landed on does, against the recurrence');
  assert.deepEqual(
    listOccurrenceDates(moved, MON, FRI).map(dayKey),
    [dayKey(THU), dayKey(FRI)],
    'the occurrence walk follows it, so every reader does'
  );

  const landed = resolveDayAssignee(moved, trio, THU, MON);
  assert.equal(landed.userId, 'u2', 'it stays with whoever owed it');
  assert.equal(landed.movedFrom, dayKey(WED), 'and remembers where it came from');
  assert.equal(
    resolveDayAssignee(moved, trio, FRI, MON).userId,
    'u3',
    'Friday is untouched: the pair consumes exactly one turn between them'
  );

  // Completing the relocated day must not send it back to Wednesday.
  const done = {
    ...moved,
    completions: withCompletion(moved, THU, { userId: 'u2', logId: 'l9', at: THU.toISOString() }, MON)
  };
  assert.equal(choreOccursOnDate(done, THU, MON), true, 'completing it keeps it on its new day');
  assert.equal(choreOccursOnDate(done, WED, MON), false, 'and does not resurrect the old one');
  assert.equal(resolveDayAssignee(done, trio, THU, MON).done, true, 'the completion lands on the new day');
  assert.equal(
    resolveDayAssignee(done, trio, FRI, MON).userId,
    'u3',
    'and still costs the queue one turn, not two'
  );

  // Undoing the completion reopens the day where it now sits.
  const reopened = { ...done, completions: withoutCompletion(done, THU, MON) };
  assert.equal(choreOccursOnDate(reopened, THU, MON), true, 'undo leaves the move in place');
  assert.equal(resolveDayAssignee(reopened, trio, THU, MON).done, false, 'the day is open again');
  assert.equal(resolveDayAssignee(reopened, trio, THU, MON).userId, 'u2', 'and owed by the same resident');

  // Dragging it home clears the relocation rather than stacking another.
  const home = { ...moved, completions: withMovedOccurrence(moved, THU, WED, 'u2', MON) };
  assert.deepEqual(home.completions, {}, 'moving an occurrence back where it came from leaves no markers');
  assert.equal(choreOccursOnDate(home, WED, MON), true, 'and the recurrence takes over again');

  // Either end can withdraw it.
  for (const end of [WED, THU]) {
    const undone = { ...moved, completions: withoutRearrangement(moved, end, MON) };
    assert.deepEqual(undone.completions, {}, `withdrawing from ${dayKey(end)} clears both halves`);
  }
}

{
  // A swap is a trade between two days, not a change to the queue.
  const daily = makeChore({ currentIndex: 0 });
  assert.equal(resolveDayAssignee(daily, trio, MON, MON).userId, 'u1');
  assert.equal(resolveDayAssignee(daily, trio, WED, MON).userId, 'u3');

  const swapped = { ...daily, completions: withSwappedDays(daily, MON, 'u1', WED, 'u3', MON) };
  assert.equal(resolveDayAssignee(swapped, trio, MON, MON).userId, 'u3', 'Monday is taken over');
  assert.equal(resolveDayAssignee(swapped, trio, WED, MON).userId, 'u1', 'and Wednesday goes the other way');
  assert.equal(choreOccursOnDate(swapped, MON, MON), true, 'both days keep their occurrence');
  assert.equal(choreOccursOnDate(swapped, WED, MON), true);
  assert.equal(
    resolveDayAssignee(swapped, trio, TUE, MON).userId,
    'u2',
    'the day between them is not dragged along'
  );
  assert.equal(resolveDayAssignee(swapped, trio, THU, MON).userId, 'u1', 'nor is the day after');

  // The case the pointer rule exists for: a completed swap must not re-anchor.
  const afterDone = {
    ...swapped,
    completions: withCompletion(swapped, MON, { userId: 'u3', logId: 'l3', at: MON.toISOString() }, MON)
  };
  assert.equal(resolveDayAssignee(afterDone, trio, MON, MON).completedBy, 'u3', 'u3 gets the credit');
  assert.equal(
    resolveDayAssignee(afterDone, trio, TUE, MON).userId,
    'u2',
    'but taking Monday off u1 does not also take Tuesday off u2'
  );
  assert.equal(resolveDayAssignee(afterDone, trio, WED, MON).userId, 'u1', 'and u1 still owes the day they traded for');

  const withdrawn = { ...swapped, completions: withoutRearrangement(swapped, WED, MON) };
  assert.deepEqual(withdrawn.completions, {}, 'undoing a swap from either end clears both days');
  assert.equal(resolveDayAssignee(withdrawn, trio, MON, MON).userId, 'u1', 'and the queue is back as it was');
}

{
  // Retention: half a relocation is worse than none of it. The two days sit
  // either side of the age cutoff, well clear of it so a daylight-saving shift
  // in the window cannot decide the result.
  const src = shiftDay(TUE, -200);
  const tgt = shiftDay(TUE, -175);
  const straddling = makeChore({
    completions: {
      [dayKey(src)]: { userId: 'u1', at: src.toISOString(), movedTo: dayKey(tgt), pending: true },
      [dayKey(tgt)]: {
        userId: 'u1',
        at: src.toISOString(),
        movedFrom: dayKey(src),
        assignedTo: 'u1',
        pending: true
      }
    }
  });
  const pruned = withCompletion(straddling, TUE, { userId: 'u1', at: TUE.toISOString() }, TUE);
  assert.equal(dayKey(src) in pruned, false, 'the older half ages out');
  assert.equal(
    dayKey(tgt) in pruned,
    false,
    'and the surviving half goes with it, rather than leaving the occurrence on two days at once'
  );

  const recent = makeChore({
    completions: {
      [dayKey(shiftDay(TUE, -10))]: {
        userId: 'u1',
        at: TUE.toISOString(),
        movedTo: dayKey(shiftDay(TUE, -8)),
        pending: true
      },
      [dayKey(shiftDay(TUE, -8))]: {
        userId: 'u1',
        at: TUE.toISOString(),
        movedFrom: dayKey(shiftDay(TUE, -10)),
        assignedTo: 'u1',
        pending: true
      }
    }
  });
  const keptWhole = withCompletion(recent, TUE, { userId: 'u1', at: TUE.toISOString() }, TUE);
  assert.equal(Object.keys(keptWhole).length, 3, 'an intact pair inside the window is left alone');
}

{
  // A rearranged day never moved the pointer, so it must not block a rewind.
  const completions = {
    [dayKey(TUE)]: { userId: 'u1', logId: 'l1', at: TUE.toISOString() },
    [dayKey(WED)]: {
      userId: 'u3',
      at: WED.toISOString(),
      assignedTo: 'u3',
      swappedWith: dayKey(FRI),
      pending: true
    }
  };
  assert.equal(
    currentIndexAfterUndo(makeChore({ currentIndex: 2, completions }), TUE, 0, THU),
    0,
    'a later day that was only rearranged still lets undo hand the turn back'
  );

  const laterCompletion = {
    [dayKey(TUE)]: { userId: 'u1', logId: 'l1', at: TUE.toISOString() },
    [dayKey(WED)]: { userId: 'u2', logId: 'l2', at: WED.toISOString() }
  };
  assert.equal(
    currentIndexAfterUndo(makeChore({ currentIndex: 2, completions: laterCompletion }), TUE, 0, THU),
    2,
    'but a later completion did move it, and rewinding would hand the same turn out twice'
  );
}

console.log('rotation tests passed');
