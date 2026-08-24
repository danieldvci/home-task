'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type CollapsibleSectionProps = {
  title: string;
  Icon?: LucideIcon;
  /** Short right-aligned note, typically a count, readable while collapsed. */
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

/**
 * A settings section that folds away. Open state is deliberately local: these
 * are set-once controls, and a remembered position is not worth persisting.
 */
export function CollapsibleSection({
  title,
  Icon,
  hint,
  defaultOpen = false,
  children
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 w-full text-right px-1 py-1 rounded-2xl hover:bg-[#F3EFE9] transition-colors"
      >
        <span className="flex items-center gap-2 font-bold text-[#6B5E4C]">
          {Icon && <Icon className="w-4 h-4 text-[#A39788]" />}
          {title}
        </span>
        <span className="flex items-center gap-2">
          {hint && <span className="text-xs font-medium text-[#A39788]">{hint}</span>}
          <ChevronDown
            className={`w-4 h-4 text-[#A39788] transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-col gap-4"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
