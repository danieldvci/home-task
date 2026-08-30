'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Avatar } from './Avatar';
import type { DayTally, UserTotal } from '../lib/activity-stats';

export type ChartPerson = { id: string; name: string; color: string; photoURL?: string | null };

type ActivityChartProps = {
  days: DayTally[];
  totals: UserTotal[];
  people: ChartPerson[];
  /** Tallest day in the window; every bar is drawn relative to it. */
  max: number;
  todayKey: string;
};

const PLOT_HEIGHT = 112;
// A resident who did one thing on a busy day would otherwise round away to
// nothing, and an empty sliver reads as "did not help".
const MIN_SEGMENT = 4;

const dayLabel = (date: Date, windowSize: number) =>
  windowSize <= 7
    ? date.toLocaleDateString('he-IL', { weekday: 'narrow' })
    : String(date.getDate());

// 30 columns cannot each carry a legible label on a phone, so thin them out.
const labelStride = (windowSize: number) => (windowSize <= 7 ? 1 : windowSize <= 14 ? 2 : 5);

const shortDate = (date: Date) =>
  date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });

export function ActivityChart({ days, totals, people, max, todayKey }: ActivityChartProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const byId = new Map(people.map(p => [p.id, p]));
  const stride = labelStride(days.length);
  // Changing a filter can drop the day that was open; falling back to null
  // beats holding a key that no longer has a column.
  const selectedDay = days.find(d => d.key === selectedKey && d.total > 0) ?? null;
  const nameOf = (userId: string) => byId.get(userId)?.name ?? '';

  if (max === 0) {
    return (
      <p className="text-sm text-[#A39788] py-6 text-center">
        אין פעילות בטווח הזה עדיין.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Oldest on the right, matching the reading direction and the week grid. */}
      <div className="flex items-end justify-between gap-[3px] border-b border-[#E6E0D4] pb-1">
        {days.map((day, i) => {
          const isToday = day.key === todayKey;
          const isSelected = selectedDay?.key === day.key;
          const detail = day.entries.map(e => `${e.choreName} (${nameOf(e.userId)})`).join(', ');
          const bar = (
            <>
              {days.length <= 7 && (
                <span className="text-[10px] font-bold text-[#8C7E6A] tabular-nums">
                  {day.total || ''}
                </span>
              )}
              <div
                className="w-full flex flex-col justify-end rounded-t-md overflow-hidden"
                style={{ height: PLOT_HEIGHT }}
              >
                {day.total === 0 ? (
                  <div className="w-full h-[3px] bg-[#EFEAE1] rounded-full" />
                ) : (
                  people.map(person => {
                    const count = day.byUser[person.id];
                    if (!count) return null;
                    return (
                      <div
                        key={person.id}
                        className={`w-full ${person.color}`}
                        style={{ height: Math.max((count / max) * PLOT_HEIGHT, MIN_SEGMENT) }}
                      />
                    );
                  })
                )}
              </div>
              <span
                className={`text-[10px] tabular-nums ${isToday ? 'font-extrabold text-[#6B5E4C]' : 'text-[#A39788]'}`}
              >
                {i % stride === 0 || isToday ? dayLabel(day.date, days.length) : '\u00A0'}
              </span>
            </>
          );

          const shared = 'flex-1 flex flex-col items-center gap-1 min-w-0 rounded-lg transition-colors';

          // A day with nothing on it has no breakdown to open.
          if (day.total === 0) {
            return (
              <div key={day.key} className={shared} title={shortDate(day.date)}>
                {bar}
              </div>
            );
          }

          return (
            <button
              key={day.key}
              type="button"
              onClick={() => setSelectedKey(isSelected ? null : day.key)}
              aria-pressed={isSelected}
              title={`${shortDate(day.date)} — ${detail}`}
              className={`${shared} ${isSelected ? 'bg-[#F1ECE3]' : 'hover:bg-[#F8F5F0]'}`}
            >
              {bar}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        {totals.map(total => {
          const person = byId.get(total.userId);
          if (!person) return null;
          return (
            <div key={total.userId} className="flex items-center gap-1.5">
              <Avatar
                name={person.name}
                color={person.color}
                photoURL={person.photoURL}
                size="sm"
                className={total.count === 0 ? 'opacity-40' : ''}
              />
              <span className="text-xs font-medium text-[#8C7E6A]">{person.name}</span>
              <span className="text-xs font-extrabold text-[#3D3732] tabular-nums">{total.count}</span>
            </div>
          );
        })}
      </div>

      {/* A title tooltip never opens on a touch screen, so the breakdown has to
          be reachable by tapping a column. */}
      {selectedDay ? (
        <div className="bg-[#FAF9F6] border border-[#E6E0D4] rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-[#3D3732]">
              {selectedDay.date.toLocaleDateString('he-IL', {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit'
              })}
            </span>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              aria-label="סגירת הפירוט"
              className="p-1 rounded-lg text-[#8C7E6A] hover:bg-[#F1ECE3] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {selectedDay.entries.map(entry => {
              const person = byId.get(entry.userId);
              return (
                <li key={entry.choreId} className="flex items-center gap-2 min-w-0">
                  {person && (
                    <Avatar
                      name={person.name}
                      color={person.color}
                      photoURL={person.photoURL}
                      size="sm"
                    />
                  )}
                  <span className="text-xs font-medium text-[#3D3732] truncate">
                    {entry.choreName}
                  </span>
                  <span className="text-[11px] text-[#A39788] flex-shrink-0">
                    {person?.name}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-[#A39788] text-center">
          הקישו על עמודה כדי לראות אילו משימות בוצעו
        </p>
      )}
    </div>
  );
}
