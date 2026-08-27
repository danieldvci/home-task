'use client';

import React from 'react';
import { Check, ChevronLeft, ChevronRight, UserX, X } from 'lucide-react';
import { Avatar } from './Avatar';
import type { CellState } from '../lib/schedule-view';

export type WeekPerson = {
  id: string;
  name: string;
  color: string;
  photoURL?: string;
};

export type WeekCell = {
  // Mirrors the day view's state for the same date. The grid used to carry only
  // a person, which is why a finished day and a missed one looked identical.
  state: CellState;
  person: WeekPerson | null;
};

export type WeekRow = {
  choreId: string;
  choreName: string;
  frequencyLabel: string;
  cells: WeekCell[];
};

const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const STATE_LABEL: Record<CellState, string> = {
  none: '',
  open: 'ממתין',
  overdue: 'לא בוצע',
  done: 'בוצע',
  cancelled: 'נסגר ללא ביצוע',
  unavailable: 'אין דייר זמין'
};

type WeekOverviewProps = {
  days: Date[];
  todayStr: string;
  rows: WeekRow[];
  legend: WeekPerson[];
  onSelectDay?: (date: Date) => void;
  onShiftWeek?: (days: number) => void;
  rangeLabel?: string;
};

function CellContent({ cell }: { cell: WeekCell }) {
  if (cell.state === 'unavailable') {
    return <UserX className="w-4 h-4 mx-auto text-[#C4BBAC]" />;
  }
  if (!cell.person) return <span className="text-[#D8D1C4] text-sm font-bold">·</span>;

  return (
    <span className="relative inline-block">
      <Avatar
        name={cell.person.name}
        color={cell.person.color}
        photoURL={cell.person.photoURL}
        size="sm"
        className={
          cell.state === 'done'
            ? 'opacity-45'
            : cell.state === 'cancelled'
              ? 'opacity-30 grayscale'
              : cell.state === 'overdue'
                ? 'ring-2 ring-rose-400'
                : ''
        }
      />
      {cell.state === 'done' && (
        <span className="absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full bg-[#A1C181] flex items-center justify-center">
          <Check className="w-2 h-2 text-white" strokeWidth={4} />
        </span>
      )}
      {cell.state === 'overdue' && (
        <span className="absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full bg-rose-500 border border-white" />
      )}
      {cell.state === 'cancelled' && (
        <span className="absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full bg-[#A39788] flex items-center justify-center">
          <X className="w-2 h-2 text-white" strokeWidth={4} />
        </span>
      )}
    </span>
  );
}

export function WeekOverview({
  days,
  todayStr,
  rows,
  legend,
  onSelectDay,
  onShiftWeek,
  rangeLabel
}: WeekOverviewProps) {
  const nav = onShiftWeek && (
    <div className="flex items-center justify-between gap-2 bg-white border border-[#E6E0D4] rounded-2xl px-2 py-1.5 shadow-sm">
      <button
        type="button"
        onClick={() => onShiftWeek(-7)}
        aria-label="שבוע קודם"
        title="שבוע קודם"
        className="p-2 rounded-xl text-[#8C7E6A] hover:bg-[#F5F1EA] transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <span className="text-xs font-bold text-[#6B5E4C]">{rangeLabel}</span>
      <button
        type="button"
        onClick={() => onShiftWeek(7)}
        aria-label="שבוע הבא"
        title="שבוע הבא"
        className="p-2 rounded-xl text-[#8C7E6A] hover:bg-[#F5F1EA] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 pb-24">
        {nav}
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 bg-[#F5F1EA] rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">🗓️</span>
          </div>
          <h3 className="text-xl font-bold text-[#3D3732] mb-1">אין תורנויות להצגה</h3>
          <p className="text-[#8C7E6A]">נסה לשנות את הסינון.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      {nav}
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
                {row.cells.map((cell, i) => {
                  const day = days[i];
                  const isToday = day.toDateString() === todayStr;
                  const dayLabel = `${DAY_LETTERS[day.getDay()]} ${day.getDate()}`;
                  const title = [cell.person?.name, STATE_LABEL[cell.state], dayLabel]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <td
                      key={day.toDateString()}
                      className={`px-0.5 py-1.5 align-middle ${isToday ? 'bg-[#A1C181]/10' : ''}`}
                    >
                      {cell.state === 'none' ? (
                        <span className="text-[#D8D1C4] text-sm font-bold">·</span>
                      ) : onSelectDay ? (
                        <button
                          type="button"
                          onClick={() => onSelectDay(day)}
                          title={title}
                          aria-label={title}
                          className="mx-auto block rounded-full transition-transform active:scale-90 hover:ring-2 hover:ring-[#A1C181]/50"
                        >
                          <CellContent cell={cell} />
                        </button>
                      ) : (
                        <div className="mx-auto w-fit" title={title}>
                          <CellContent cell={cell} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        {legend.map(p => (
          <div key={p.id} className="flex items-center gap-1.5">
            <Avatar name={p.name} color={p.color} photoURL={p.photoURL} size="sm" />
            <span className="text-xs font-medium text-[#8C7E6A]">{p.name}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[11px] text-[#8C7E6A]">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#A1C181] flex items-center justify-center">
            <Check className="w-2 h-2 text-white" strokeWidth={4} />
          </span>
          בוצע
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-rose-500 border border-white" />
          לא בוצע
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#A39788] flex items-center justify-center">
            <X className="w-2 h-2 text-white" strokeWidth={4} />
          </span>
          נסגר
        </span>
        <span className="flex items-center gap-1.5">
          <UserX className="w-3.5 h-3.5 text-[#C4BBAC]" />
          אין דייר זמין
        </span>
      </div>
    </div>
  );
}
