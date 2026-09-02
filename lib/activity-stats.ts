import { dayKey, isCompletedRecord } from './rotation';
import type { Chore } from './rotation';
import { shiftDays } from './schedule-view';

/**
 * Per-person activity over a window of days.
 *
 * Counted from `chore.completions` rather than the activity log. The log is
 * capped at a fixed number of recent entries with no date filter, so a longer
 * window would silently truncate, and it is append-only: undoing a completion
 * adds a second record instead of removing the first, which would leave
 * reversed work counted. The completions map is the same state the day and week views render
 * from, so the chart cannot disagree with the schedule.
 */

/** One completed occurrence. A chore occurs at most once a day, so a day never
 *  holds two entries for the same chore. */
export type DayEntry = { choreId: string; choreName: string; userId: string };

export type DayTally = {
  key: string;
  date: Date;
  byUser: Record<string, number>;
  total: number;
  /** What the count is made of, so a bar can name the tasks behind it. */
  entries: DayEntry[];
};

export type UserTotal = { userId: string; count: number };

export const ACTIVITY_WINDOWS = [7, 14, 30] as const;
export const DEFAULT_ACTIVITY_WINDOW = 14;

/**
 * One entry per day in the window, oldest first, including days when nothing
 * happened so the bars stay evenly spaced.
 *
 * Only `userIds` are counted. A resident who has since been removed leaves
 * their completions behind, and counting them would make the day total exceed
 * the segments the chart can draw.
 */
export const activityByDay = (
  chores: Chore[],
  userIds: string[],
  days: number,
  today: Date
): DayTally[] => {
  const counted = new Set(userIds);
  const window: DayTally[] = [];
  const byKey = new Map<string, DayTally>();

  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDays(today, -i);
    const tally: DayTally = { key: dayKey(date), date, byUser: {}, total: 0, entries: [] };
    window.push(tally);
    byKey.set(tally.key, tally);
  }

  for (const chore of chores) {
    if (!chore.completions) continue;
    for (const [key, record] of Object.entries(chore.completions)) {
      // A skipped day handed the turn on and a cancelled day was written off.
      // Neither is work anybody did.
      if (!isCompletedRecord(record)) continue;
      if (!counted.has(record.userId)) continue;
      const tally = byKey.get(key);
      if (!tally) continue;
      tally.byUser[record.userId] = (tally.byUser[record.userId] ?? 0) + 1;
      tally.total += 1;
      tally.entries.push({ choreId: chore.id, choreName: chore.name, userId: record.userId });
    }
  }

  return window;
};

/** Window totals per resident, busiest first. Residents with nothing are kept
 *  so the legend shows the whole household. */
export const activityTotals = (days: DayTally[], userIds: string[]): UserTotal[] => {
  const totals = new Map<string, number>(userIds.map(id => [id, 0]));
  for (const day of days) {
    for (const [userId, count] of Object.entries(day.byUser)) {
      if (totals.has(userId)) totals.set(userId, totals.get(userId)! + count);
    }
  }
  return userIds
    .map(userId => ({ userId, count: totals.get(userId) ?? 0 }))
    .sort((a, b) => b.count - a.count);
};

/** Tallest bar in the window, used to scale the rest. */
export const busiestDay = (days: DayTally[]) =>
  days.reduce((max, day) => Math.max(max, day.total), 0);
