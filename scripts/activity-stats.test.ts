import assert from 'node:assert/strict';
import {
  activityByDay,
  activityTotals,
  busiestDay
} from '../lib/activity-stats';
import { dayKey } from '../lib/rotation';
import { shiftDays } from '../lib/schedule-view';
import type { Chore, ChoreCompletion } from '../lib/rotation';

// Aug 18 2026 is a Tuesday.
const TUE = new Date(2026, 7, 18, 12, 0, 0);
const MON = shiftDays(TUE, -1);

const done = (userId: string, day: Date): ChoreCompletion => ({
  userId,
  at: day.toISOString()
});

const makeChore = (over: Partial<Chore> = {}): Chore => ({
  id: 'c1',
  name: 'כלים',
  frequency: 'daily',
  rotation: ['u1', 'u2', 'u3'],
  currentIndex: 0,
  lastCompletedAt: null,
  ...over
});

const TRIO = ['u1', 'u2', 'u3'];

// --- The window -------------------------------------------------------------

{
  const days = activityByDay([], TRIO, 7, TUE);
  assert.equal(days.length, 7, 'one entry per day asked for');
  assert.equal(days[6].key, dayKey(TUE), 'the window ends on today');
  assert.equal(days[0].key, dayKey(shiftDays(TUE, -6)), 'and reaches back to include it');
  assert.ok(
    days.every(d => d.total === 0 && Object.keys(d.byUser).length === 0),
    'no chores means no activity rather than missing days'
  );
}

{
  // A quiet day has to stay in the list, or the bars bunch up and the gap in
  // activity stops being visible.
  const chore = makeChore({ completions: { [dayKey(TUE)]: done('u1', TUE) } });
  const days = activityByDay([chore], TRIO, 3, TUE);
  assert.deepEqual(days.map(d => d.total), [0, 0, 1], 'empty days are kept in place');
}

{
  const chore = makeChore({
    completions: { [dayKey(shiftDays(TUE, -30))]: done('u1', shiftDays(TUE, -30)) }
  });
  assert.equal(
    busiestDay(activityByDay([chore], TRIO, 7, TUE)),
    0,
    'work older than the window is not counted'
  );
}

// --- What counts as work ----------------------------------------------------

{
  const chore = makeChore({
    completions: {
      [dayKey(TUE)]: done('u1', TUE),
      [dayKey(MON)]: { ...done('u2', MON), skipped: true }
    }
  });
  const days = activityByDay([chore], TRIO, 2, TUE);
  assert.equal(days[0].total, 0, 'a skipped day only moved the turn on, nobody did it');
  assert.equal(days[1].total, 1, 'a completed day counts');
}

{
  const chore = makeChore({
    completions: { [dayKey(MON)]: { ...done('u2', MON), cancelled: true } }
  });
  assert.equal(
    busiestDay(activityByDay([chore], TRIO, 2, TUE)),
    0,
    'a day written off without being done is not work'
  );
}

{
  // A day that was only moved or swapped carries a resident and a timestamp
  // like any other record, so a chart that decides by listing the flags that
  // mean "not done" credits nobody's work to somebody.
  const chore = makeChore({
    completions: {
      [dayKey(TUE)]: { ...done('u1', TUE), movedTo: dayKey(MON), pending: true },
      [dayKey(MON)]: { ...done('u1', MON), movedFrom: dayKey(TUE), assignedTo: 'u1', pending: true }
    }
  });
  const days = activityByDay([chore], TRIO, 2, TUE);
  assert.equal(busiestDay(days), 0, 'rearranging a day is not work anybody did');
  assert.deepEqual(days.flatMap(d => d.entries), [], 'and contributes no breakdown row');

  // Once it is actually done, on its new day, it counts exactly once.
  const finished = makeChore({
    completions: {
      [dayKey(TUE)]: { ...done('u1', TUE), movedTo: dayKey(MON), pending: true },
      [dayKey(MON)]: { ...done('u1', MON), movedFrom: dayKey(TUE), assignedTo: 'u1' }
    }
  });
  const after = activityByDay([finished], TRIO, 2, TUE);
  assert.deepEqual(after.map(d => d.total), [1, 0], 'the completion counts on the day it moved to');
}

{
  // Their completions stay in the map after they leave, but the chart has no
  // resident to draw them as, so counting them would make the total exceed the
  // segments.
  const chore = makeChore({ completions: { [dayKey(TUE)]: done('ghost', TUE) } });
  const [today] = activityByDay([chore], TRIO, 1, TUE);
  assert.equal(today.total, 0, 'a removed resident is not counted');
  assert.deepEqual(today.byUser, {}, 'and leaves no orphan segment');
}

// --- Attribution ------------------------------------------------------------

{
  const dishes = makeChore({ id: 'a', completions: { [dayKey(TUE)]: done('u1', TUE) } });
  const bins = makeChore({ id: 'b', completions: { [dayKey(TUE)]: done('u1', TUE) } });
  const floor = makeChore({ id: 'c', completions: { [dayKey(TUE)]: done('u2', TUE) } });

  const [today] = activityByDay([dishes, bins, floor], TRIO, 1, TUE);
  assert.deepEqual(today.byUser, { u1: 2, u2: 1 }, 'a day sums every chore, per resident');
  assert.equal(today.total, 3, 'and the total agrees with the segments');
  assert.equal(
    Object.values(today.byUser).reduce((a, b) => a + b, 0),
    today.total,
    'the segments always add up to the bar'
  );
}

{
  // Completion is keyed by who did it, not by whose turn it was, so a swapped
  // or covered turn lands on the person who actually did the work.
  const chore = makeChore({ completions: { [dayKey(TUE)]: done('u3', TUE) } });
  const [today] = activityByDay([chore], TRIO, 1, TUE);
  assert.deepEqual(today.byUser, { u3: 1 }, 'credit follows the doer');
}

// --- Totals for the legend --------------------------------------------------

{
  const chore = makeChore({
    completions: {
      [dayKey(TUE)]: done('u2', TUE),
      [dayKey(MON)]: done('u2', MON),
      [dayKey(shiftDays(TUE, -2))]: done('u1', shiftDays(TUE, -2))
    }
  });
  const days = activityByDay([chore], TRIO, 7, TUE);

  assert.deepEqual(
    activityTotals(days, TRIO),
    [
      { userId: 'u2', count: 2 },
      { userId: 'u1', count: 1 },
      { userId: 'u3', count: 0 }
    ],
    'busiest first, and a resident who did nothing still appears'
  );
  assert.equal(busiestDay(days), 1, 'the tallest bar is one day, not the window total');
}

{
  assert.deepEqual(
    activityTotals(activityByDay([], [], 7, TUE), []),
    [],
    'an empty household has no legend'
  );
}

// --- What a bar is made of --------------------------------------------------
// The chart is coloured by person, so without these a bar cannot answer "which
// task was this".

{
  const dishes = makeChore({ id: 'a', name: 'כלים', completions: { [dayKey(TUE)]: done('u1', TUE) } });
  const bins = makeChore({ id: 'b', name: 'זבל', completions: { [dayKey(TUE)]: done('u2', TUE) } });

  const [today] = activityByDay([dishes, bins], TRIO, 1, TUE);
  assert.deepEqual(
    today.entries,
    [
      { choreId: 'a', choreName: 'כלים', userId: 'u1' },
      { choreId: 'b', choreName: 'זבל', userId: 'u2' }
    ],
    'a day names the task and who did it, so the breakdown can be read off it'
  );
  assert.equal(today.entries.length, today.total, 'one entry per counted completion');
}

{
  // Whatever the bar excludes, the breakdown under it has to exclude too, or
  // tapping a bar lists work the bar never counted.
  const chore = makeChore({
    completions: {
      [dayKey(TUE)]: { ...done('u1', TUE), skipped: true },
      [dayKey(MON)]: { ...done('u2', MON), cancelled: true }
    }
  });
  const days = activityByDay([chore], TRIO, 2, TUE);
  assert.deepEqual(
    days.flatMap(d => d.entries),
    [],
    'skipped and cancelled days contribute no breakdown'
  );
}

{
  const chore = makeChore({ completions: { [dayKey(TUE)]: done('ghost', TUE) } });
  const [today] = activityByDay([chore], TRIO, 1, TUE);
  assert.deepEqual(today.entries, [], 'a removed resident leaves no breakdown row either');
}

// --- Filtering, which the caller does by narrowing the arguments -------------

{
  const dishes = makeChore({ id: 'a', name: 'כלים', completions: { [dayKey(TUE)]: done('u1', TUE) } });
  const bins = makeChore({ id: 'b', name: 'זבל', completions: { [dayKey(TUE)]: done('u2', TUE) } });

  const [onlyDishes] = activityByDay([dishes], TRIO, 1, TUE);
  assert.deepEqual(onlyDishes.byUser, { u1: 1 }, 'narrowing the chores narrows the bars');
  assert.deepEqual(
    onlyDishes.entries.map(e => e.choreName),
    ['כלים'],
    'and the breakdown follows the same selection'
  );

  const [onlyU2] = activityByDay([dishes, bins], ['u2'], 1, TUE);
  assert.equal(onlyU2.total, 1, 'narrowing the residents drops the others from the total');
  assert.deepEqual(
    activityTotals([onlyU2], ['u2']),
    [{ userId: 'u2', count: 1 }],
    'and the legend shows only who was asked for'
  );
}

console.log('activity-stats tests passed');
