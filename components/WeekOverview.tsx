'use client';

import React from 'react';
import { Avatar } from './Avatar';

export type WeekPerson = {
  id: string;
  name: string;
  color: string;
  photoURL?: string;
};

export type WeekRow = {
  choreId: string;
  choreName: string;
  frequencyLabel: string;
  // One entry per day of the week: who is on duty, or null when the chore is
  // not scheduled that day (or filtered out).
  cells: (WeekPerson | null)[];
};

const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

type WeekOverviewProps = {
  days: Date[];
  todayStr: string;
  rows: WeekRow[];
  legend: WeekPerson[];
  onSelectDay?: (date: Date) => void;
};

export function WeekOverview({ days, todayStr, rows, legend, onSelectDay }: WeekOverviewProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-20 h-20 bg-[#F5F1EA] rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">🗓️</span>
        </div>
        <h3 className="text-xl font-bold text-[#3D3732] mb-1">אין תורנויות להצגה</h3>
        <p className="text-[#8C7E6A]">נסה לשנות את הסינון.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      <div className="bg-white border border-[#E6E0D4] rounded-3xl shadow-sm overflow-x-auto">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr className="border-b border-[#E6E0D4]">
              <th className="sticky right-0 z-10 bg-white text-right text-[11px] font-bold text-[#8C7E6A] px-3 py-2 min-w-[88px]">
                משימה
              </th>
              {days.map(day => {
                const isToday = day.toDateString() === todayStr;
                return (
                  <th key={day.toDateString()} className="px-0.5 py-2 min-w-[36px]">
                    <div
                      className={`flex flex-col items-center justify-center rounded-xl py-1 ${isToday ? 'bg-[#A1C181] text-white shadow-sm' : 'text-[#8C7E6A]'}`}
                    >
                      <span className="text-[10px] font-bold">{DAY_LETTERS[day.getDay()]}</span>
                      <span className="text-[11px] font-extrabold">{day.getDate()}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.choreId} className="border-b border-[#F1ECE3] last:border-0">
                <th scope="row" className="sticky right-0 z-10 bg-white text-right px-3 py-2 min-w-[88px]">
                  <span className="block text-xs font-bold text-[#3D3732] leading-tight">{row.choreName}</span>
                  <span className="block text-[10px] text-[#A39788] font-medium">{row.frequencyLabel}</span>
                </th>
                {row.cells.map((person, i) => {
                  const day = days[i];
                  const isToday = day.toDateString() === todayStr;
                  return (
                    <td
                      key={day.toDateString()}
                      className={`px-0.5 py-1.5 align-middle ${isToday ? 'bg-[#A1C181]/10' : ''}`}
                    >
                      {person ? (
                        onSelectDay ? (
                          <button
                            type="button"
                            onClick={() => onSelectDay(day)}
                            title={`${person.name} · ${DAY_LETTERS[day.getDay()]} ${day.getDate()}`}
                            className="mx-auto block rounded-full transition-transform active:scale-90 hover:ring-2 hover:ring-[#A1C181]/50"
                          >
                            <Avatar name={person.name} color={person.color} photoURL={person.photoURL} size="sm" />
                          </button>
                        ) : (
                          <div className="mx-auto w-fit" title={person.name}>
                            <Avatar name={person.name} color={person.color} photoURL={person.photoURL} size="sm" />
                          </div>
                        )
                      ) : (
                        <span className="text-[#D8D1C4] text-sm font-bold">·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
          {legend.map(p => (
            <div key={p.id} className="flex items-center gap-1.5">
              <Avatar name={p.name} color={p.color} photoURL={p.photoURL} size="sm" />
              <span className="text-xs font-medium text-[#8C7E6A]">{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
