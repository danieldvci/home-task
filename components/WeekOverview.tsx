'use client';

import React from 'react';
import {
  ArrowRightLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Loader2,
  Plus,
  UserX,
  X
} from 'lucide-react';
import { motion } from 'motion/react';
import { Avatar } from './Avatar';
import type { CellState, DropKind, DropTarget } from '../lib/schedule-view';

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
  /** The day this occurrence was dragged here from, when it was moved. */
  movedFrom?: string | null;
  /** Its resident was chosen by a move or a swap rather than by the queue. */
  rearranged?: boolean;
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

// Long enough not to fire while the grid is being panned sideways, short enough
// that it does not feel like the tap was missed.
const LONG_PRESS_MS = 400;
// A finger never holds perfectly still, but a pan moves much further than this.
const DRIFT_TOLERANCE_PX = 8;

// A mouse or trackpad can drag; a finger shares the gesture with the grid's own
// horizontal scrolling, so touch keeps pick-and-place instead. Read through
// useSyncExternalStore so the first client render already knows, without a
// state update in an effect.
const subscribePointer = (onChange: () => void) => {
  const query = window.matchMedia('(pointer: fine)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const pointerIsFine = () => window.matchMedia('(pointer: fine)').matches;

/**
 * Which day column sits under the pointer.
 *
 * Asks the document what is there rather than working it out from offsets, so
 * the right-to-left column order never enters the arithmetic. The dragged cell
 * is taken out of the hit test first: it is still sitting under the cursor at
 * the moment the drag ends, and would otherwise answer for its own column.
 */
const dayIndexUnder = (x: number, y: number, dragged: HTMLElement | null) => {
  const restore = dragged?.style.pointerEvents ?? '';
  if (dragged) dragged.style.pointerEvents = 'none';
  const hit = document.elementFromPoint(x, y);
  if (dragged) dragged.style.pointerEvents = restore;

  const cell = hit?.closest('td[data-day-index]');
  if (!cell) return null;
  const index = Number(cell.getAttribute('data-day-index'));
  return Number.isInteger(index) ? index : null;
};

type WeekOverviewProps = {
  days: Date[];
  todayStr: string;
  rows: WeekRow[];
  legend: WeekPerson[];
  onSelectDay?: (date: Date) => void;
  onShiftWeek?: (days: number) => void;
  rangeLabel?: string;
  /**
   * Why `rows` is empty. The grid cannot tell on its own, and blaming the
   * filter unconditionally told a household with no chores to change something
   * it had never set.
   */
  emptyReason?: 'clear' | 'filtered';
  /**
   * Enables rearranging. Both callbacks have to be supplied together; leaving
   * them out leaves the grid exactly as it was.
   *
   * Awaited when it returns a promise, so the row can say it is saving for as
   * long as the write actually takes.
   */
  onRearrange?: (choreId: string, from: Date, to: Date, kind: DropKind) => void | Promise<void>;
  /** Legal drops for a picked cell. The parent computes it because it holds the
   *  chore and the residents; the grid only knows what it was handed to draw. */
  dropTargetsFor?: (choreId: string, dayIndex: number) => DropTarget[];
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
          // A done day is marked by its badge alone. Dimming it was tuned for
          // flat initials; on a photograph it reads as broken rather than
          // finished, and it collided with the greyed-out cancelled state.
          cell.state === 'cancelled'
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
      {cell.rearranged && cell.state !== 'cancelled' && (
        <span
          className="absolute -top-0.5 -left-0.5 w-3 h-3 rounded-full bg-[#7C9CBF] flex items-center justify-center"
          title={cell.movedFrom ? `הועבר מ-${cell.movedFrom}` : 'הוחלף'}
        >
          {cell.movedFrom ? (
            <CornerDownRight className="w-2 h-2 text-white" strokeWidth={4} />
          ) : (
            <ArrowRightLeft className="w-2 h-2 text-white" strokeWidth={4} />
          )}
        </span>
      )}
    </span>
  );
}

type DayCellProps = {
  cell: WeekCell;
  day: Date;
  dayIndex: number;
  title: string;
  isToday: boolean;
  /** This cell is the one being held. */
  picked: boolean;
  /** What dropping here would do, or null when it is not a legal target. */
  dropKind: DropKind | null;
  /** Something is held somewhere in the grid, so unrelated cells step back. */
  rearranging: boolean;
  canPickUp: boolean;
  /** Pointer devices drag; touch holds still instead. */
  dragEnabled: boolean;
  onSelectDay?: (date: Date) => void;
  onPickUp: () => void;
  onDrop: (kind: DropKind) => void;
  onCancel: () => void;
  /** Where a drag was released, by day column, or null if it missed. */
  onDragResolve: (targetIndex: number | null) => void;
};

function DayCell({
  cell,
  day,
  dayIndex,
  title,
  isToday,
  picked,
  dropKind,
  rearranging,
  canPickUp,
  dragEnabled,
  onSelectDay,
  onPickUp,
  onDrop,
  onCancel,
  onDragResolve
}: DayCellProps) {
  const node = React.useRef<HTMLButtonElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = React.useRef<{ x: number; y: number } | null>(null);
  // Set by the timer and read by the click that follows the same press, so a
  // pick-up does not also open the day underneath it.
  const heldLongEnough = React.useRef(false);
  // Same idea for a drag: releasing one usually ends in a click. Usually, not
  // always - a drag cancelled or released off-window never produces one - so
  // the next press clears it rather than trusting the click to. Left to the
  // click, one such drag swallowed the following tap on this cell.
  const wasDragged = React.useRef(false);

  const clearPress = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  React.useEffect(() => clearPress, [clearPress]);

  // Holding still is the touch gesture. On a pointer device it would turn any
  // slow click into a pick-up, so there it gives way to dragging.
  const pressHandlers =
    canPickUp && !dragEnabled
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            heldLongEnough.current = false;
            origin.current = { x: e.clientX, y: e.clientY };
            timer.current = setTimeout(() => {
              heldLongEnough.current = true;
              navigator.vibrate?.(10);
              onPickUp();
            }, LONG_PRESS_MS);
          },
          onPointerMove: (e: React.PointerEvent) => {
            // Panning the grid sideways must not read as holding still.
            if (!origin.current) return;
            const drifted =
              Math.abs(e.clientX - origin.current.x) > DRIFT_TOLERANCE_PX ||
              Math.abs(e.clientY - origin.current.y) > DRIFT_TOLERANCE_PX;
            if (drifted) clearPress();
          },
          onPointerUp: clearPress,
          onPointerCancel: clearPress,
          // iOS otherwise offers to copy or share the avatar on a long press.
          onContextMenu: (e: React.SyntheticEvent) => e.preventDefault()
        }
      : {};

  // Constrained to one axis because a drop is only ever legal within the row,
  // which makes a cross-row drag unexpressible rather than merely refused.
  const dragProps =
    canPickUp && dragEnabled
      ? {
          drag: 'x' as const,
          dragSnapToOrigin: true,
          dragMomentum: false,
          dragElastic: 0.15,
          whileDrag: { scale: 1.15, zIndex: 30 },
          onDragStart: () => {
            wasDragged.current = true;
            onPickUp();
          },
          onDragEnd: (event: MouseEvent | TouchEvent | PointerEvent) => {
            const at = 'clientX' in event ? { x: event.clientX, y: event.clientY } : null;
            onDragResolve(at ? dayIndexUnder(at.x, at.y, node.current) : null);
          }
        }
      : {};

  const handleClick = () => {
    if (wasDragged.current) {
      wasDragged.current = false;
      return;
    }
    if (dropKind) {
      onDrop(dropKind);
      return;
    }
    if (picked) {
      onCancel();
      return;
    }
    if (rearranging) {
      // Anywhere that is not a legal target puts the held day back down.
      onCancel();
      return;
    }
    if (heldLongEnough.current) return;
    onSelectDay?.(day);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && rearranging) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && canPickUp) {
      e.preventDefault();
      picked ? onCancel() : onPickUp();
    }
  };

  const targetStyle =
    dropKind === 'move'
      ? 'ring-2 ring-dashed ring-[#A1C181] bg-[#A1C181]/10'
      : 'ring-2 ring-dashed ring-[#7C9CBF] bg-[#7C9CBF]/10';

  const interactive = !!onSelectDay || canPickUp || !!dropKind || rearranging;
  const inert = rearranging && !picked && !dropKind;

  const body = dropKind ? (
    <span className="flex items-center justify-center w-7 h-7">
      {cell.state === 'none' ? (
        <Plus className="w-4 h-4 text-[#6B8E4E]" strokeWidth={3} />
      ) : (
        <span className="relative inline-block opacity-60">
          <CellContent cell={cell} />
        </span>
      )}
    </span>
  ) : cell.state === 'none' ? (
    <span className="text-[#D8D1C4] text-sm font-bold">·</span>
  ) : (
    <CellContent cell={cell} />
  );

  return (
    <td
      data-day-index={dayIndex}
      className={`px-0.5 py-1.5 align-middle ${isToday ? 'bg-[#A1C181]/10' : ''}`}
    >
      {!interactive ? (
        <div className="mx-auto w-fit" title={title}>
          {body}
        </div>
      ) : (
        <motion.button
          ref={node}
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onPointerDownCapture={() => {
            wasDragged.current = false;
          }}
          {...pressHandlers}
          {...dragProps}
          title={dropKind === 'move' ? 'העבר לכאן' : dropKind === 'swap' ? 'החלף עם יום זה' : title}
          aria-label={
            dropKind === 'move'
              ? `העבר לכאן · ${title}`
              : dropKind === 'swap'
                ? `החלף עם יום זה · ${title}`
                : canPickUp
                  ? `${title} · לחיצה ארוכה או Shift+Enter כדי להעביר`
                  : title
          }
          aria-pressed={canPickUp ? picked : undefined}
          disabled={inert && !onSelectDay}
          className={[
            'relative mx-auto flex items-center justify-center rounded-full transition-all',
            'select-none [-webkit-touch-callout:none]',
            canPickUp && dragEnabled ? 'cursor-grab active:cursor-grabbing' : '',
            dropKind ? targetStyle : '',
            picked ? 'ring-2 ring-[#A1C181] shadow-sm' : '',
            inert ? 'opacity-30' : '',
            !rearranging ? 'active:scale-90 hover:ring-2 hover:ring-[#A1C181]/50' : ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {body}
        </motion.button>
      )}
    </td>
  );
}

export function WeekOverview({
  days,
  todayStr,
  rows,
  legend,
  onSelectDay,
  onShiftWeek,
  rangeLabel,
  emptyReason = 'filtered',
  onRearrange,
  dropTargetsFor
}: WeekOverviewProps) {
  const canRearrange = !!onRearrange && !!dropTargetsFor;
  const [picked, setPicked] = React.useState<{ choreId: string; index: number } | null>(null);
  // The same selection, written synchronously. A drag both picks up and drops
  // through motion's own callbacks, and a quick flick can finish before React
  // has committed the pick-up, which left the drop resolving against an empty
  // selection and silently doing nothing. State drives what is drawn; this
  // drives what the drop resolves against.
  const pickedNow = React.useRef<{ choreId: string; index: number } | null>(null);
  const pickUp = React.useCallback((choreId: string, index: number) => {
    pickedNow.current = { choreId, index };
    setPicked({ choreId, index });
  }, []);
  const putDown = React.useCallback(() => {
    pickedNow.current = null;
    setPicked(null);
  }, []);
  /** The chore whose write is in flight, so the row can show it is saving. */
  const [saving, setSaving] = React.useState<string | null>(null);
  const dragEnabled = React.useSyncExternalStore(subscribePointer, pointerIsFine, () => false);

  // Derived rather than cleared in an effect: filtering a row away, or paging to
  // another week, would otherwise leave a day held with nowhere to put it. A
  // selection whose row is no longer on screen simply stops counting as held.
  const pickedRow = picked ? rows.find(r => r.choreId === picked.choreId) : undefined;
  const held = picked && pickedRow ? picked : null;
  const savingRow = saving ? rows.find(r => r.choreId === saving) : undefined;

  React.useEffect(() => {
    if (!held) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') putDown();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [held, putDown]);

  const targets = React.useMemo(
    () => (held && dropTargetsFor ? dropTargetsFor(held.choreId, held.index) : []),
    [held, dropTargetsFor]
  );

  // Takes the source explicitly rather than reading the selection, because the
  // drag path resolves from a ref that may be ahead of what has been rendered.
  const drop = async (
    source: { choreId: string; index: number },
    index: number,
    kind: DropKind
  ) => {
    if (!onRearrange) return;
    putDown();
    setSaving(source.choreId);
    try {
      await onRearrange(source.choreId, days[source.index], days[index], kind);
    } finally {
      setSaving(null);
    }
  };

  // A drag lands on a column rather than on a chosen target, so legality is
  // checked here instead of by which cell was clickable. Released anywhere that
  // is not a legal target, it simply goes back.
  const resolveDrag = (targetIndex: number | null) => {
    const source = pickedNow.current;
    if (!source) return;
    // Paging the week or filtering the row away mid-drag leaves nothing to move.
    const gone = !rows.some(r => r.choreId === source.choreId);
    if (gone || targetIndex === null || targetIndex === source.index) {
      putDown();
      return;
    }
    const kind = dropTargetsFor?.(source.choreId, source.index).find(
      t => t.index === targetIndex
    )?.kind;
    if (kind) void drop(source, targetIndex, kind);
    else putDown();
  };

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
            {emptyReason === 'filtered' ? (
              <span className="text-2xl">🗓️</span>
            ) : (
              <Check className="w-10 h-10 text-[#A1C181]" />
            )}
          </div>
          <h3 className="text-xl font-bold text-[#3D3732] mb-1">
            {emptyReason === 'filtered' ? 'אין משימות שמתאימות לסינון' : 'אין תורנויות לשבוע זה'}
          </h3>
          <p className="text-[#8C7E6A]">
            {emptyReason === 'filtered' ? 'נסה לשנות את הסינון.' : 'הכל נקי ומסודר.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      {nav}

      {held && (
        // Holding a day is a mode, and a mode the user cannot see is one they
        // cannot get out of. This also gives the cancel a full-size tap target.
        <div className="flex items-center justify-between gap-2 bg-[#A1C181]/15 border border-[#A1C181] rounded-2xl px-3 py-2">
          <span className="text-xs font-bold text-[#4A6B33] min-w-0 flex-1 truncate">
            {pickedRow?.choreName}: בחר יום להעברה או להחלפה
          </span>
          <button
            type="button"
            onClick={putDown}
            className="flex-shrink-0 text-xs font-bold text-[#6B5E4C] px-2 py-1 rounded-lg hover:bg-white/60 transition-colors"
          >
            ביטול
          </button>
        </div>
      )}

      {savingRow && (
        // There is nowhere to show the change until Firestore echoes it back,
        // and without this the avatar sprang home and sat there, which read as
        // the drop having been refused.
        <div className="flex items-center gap-2 bg-[#F5F1EA] border border-[#E6E0D4] rounded-2xl px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 flex-shrink-0 text-[#8C7E6A] animate-spin" />
          <span className="text-xs font-bold text-[#6B5E4C] min-w-0 flex-1 truncate">
            {savingRow.choreName}: שומר…
          </span>
        </div>
      )}

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
            {rows.map(row => {
              const isPickedRow = held?.choreId === row.choreId;
              const isSaving = saving === row.choreId;
              return (
                <tr
                  key={row.choreId}
                  data-chore-id={row.choreId}
                  className={`border-b border-[#F1ECE3] last:border-0 ${isSaving ? 'animate-pulse' : ''}`}
                >
                  <th
                    scope="row"
                    className={`sticky right-0 z-10 bg-white text-right px-3 py-2 min-w-[88px] transition-opacity ${
                      held && !isPickedRow ? 'opacity-30' : ''
                    }`}
                  >
                    <span className="block text-xs font-bold text-[#3D3732] leading-tight">
                      {row.choreName}
                    </span>
                    <span className="block text-[10px] text-[#A39788] font-medium">
                      {row.frequencyLabel}
                    </span>
                  </th>
                  {row.cells.map((cell, i) => {
                    const day = days[i];
                    const isToday = day.toDateString() === todayStr;
                    const dayLabel = `${DAY_LETTERS[day.getDay()]} ${day.getDate()}`;
                    const title = [cell.person?.name, STATE_LABEL[cell.state], dayLabel]
                      .filter(Boolean)
                      .join(' · ');
                    const dropKind = isPickedRow
                      ? (targets.find(t => t.index === i)?.kind ?? null)
                      : null;

                    return (
                      <DayCell
                        key={day.toDateString()}
                        cell={cell}
                        day={day}
                        dayIndex={i}
                        title={title}
                        isToday={isToday}
                        picked={isPickedRow && held?.index === i}
                        dropKind={dropKind}
                        rearranging={!!held}
                        canPickUp={
                          canRearrange &&
                          !isSaving &&
                          (!held || (isPickedRow && held.index === i)) &&
                          (cell.state === 'open' || cell.state === 'overdue') &&
                          !!cell.person
                        }
                        dragEnabled={dragEnabled}
                        onSelectDay={onSelectDay}
                        onPickUp={() => pickUp(row.choreId, i)}
                        onDrop={kind => {
                          if (held) void drop(held, i, kind);
                        }}
                        onCancel={putDown}
                        onDragResolve={resolveDrag}
                      />
                    );
                  })}
                </tr>
              );
            })}
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
        {canRearrange && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#7C9CBF] flex items-center justify-center">
              <CornerDownRight className="w-2 h-2 text-white" strokeWidth={4} />
            </span>
            הועבר או הוחלף
          </span>
        )}
      </div>
    </div>
  );
}
