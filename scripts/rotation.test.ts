import assert from 'node:assert/strict';
import {
  completionMarkers,
  dayKey,
  getActiveAssigneeIndex,
  getNextActiveIndex,
  getOccurrencesBetween,
  getPrevActiveIndex,
  isDoneOnDay,
  isUserAbsentNow,
  isUserAbsentOnDay,
  listOccurrenceDates,
  projectAssigneeIndex,
  resolveDayAssignee,
  withCompletion,
  withoutCompletion
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

console.log('rotation tests passed');
