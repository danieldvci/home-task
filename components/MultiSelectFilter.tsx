'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type FilterOption = {
  id: string;
  label: string;
  hint?: string;
  /** Rendered before the label, e.g. a resident's Avatar. */
  icon?: React.ReactNode;
};

type MultiSelectFilterProps = {
  options: FilterOption[];
  /** Empty means every option is included. */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  /** Plural noun for the "N selected" summary, e.g. 'משימות'. */
  countNoun?: string;
  className?: string;
};

/**
 * Multi-select dropdown used wherever two views must not end up filtered to
 * different sets, and now for people as well as tasks. A native
 * <select multiple> is unusable on a phone, so this is a button plus a
 * checkbox panel.
 */
export function MultiSelectFilter({
  options,
  selectedIds,
  onChange,
  allLabel,
  countNoun = 'פריטים',
  className = ''
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // An id that no longer matches an option (a deleted chore or resident) must
  // not be counted, or the summary claims a selection the list cannot show.
  const selected = options.filter(o => selectedIds.includes(o.id));
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0].label
        : `${selected.length} ${countNoun} נבחרו`;

  const toggle = (id: string) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 bg-white border border-[#E6E0D4] rounded-2xl px-4 py-3 text-sm font-medium text-[#6B5E4C] outline-none focus:border-[#A1C181] shadow-sm text-right"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected.length === 1 && selected[0].icon}
          <span className="truncate">{summary}</span>
        </span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-[#8C7E6A] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={allLabel}
          className="absolute z-30 mt-2 w-full max-h-72 overflow-y-auto bg-white border border-[#E6E0D4] rounded-2xl shadow-lg p-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={selected.length === 0}
            onClick={() => onChange([])}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm text-right transition-colors ${selected.length === 0 ? 'bg-[#F3EFE9] font-bold text-[#3D3732]' : 'text-[#6B5E4C] hover:bg-[#F5F1EA]'}`}
          >
            <span className="truncate">{allLabel}</span>
            {selected.length === 0 && <Check className="w-4 h-4 flex-shrink-0 text-[#A1C181]" />}
          </button>

          {options.length > 0 && <div className="my-1 border-t border-[#F1ECE3]" />}

          {options.map(option => {
            const isSelected = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(option.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm text-right transition-colors ${isSelected ? 'bg-[#F3EFE9] text-[#3D3732]' : 'text-[#6B5E4C] hover:bg-[#F5F1EA]'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {option.icon}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.hint && (
                      <span className="block text-[10px] text-[#A39788]">{option.hint}</span>
                    )}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${isSelected ? 'bg-[#A1C181] border-[#A1C181]' : 'border-[#D8D1C4]'}`}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
