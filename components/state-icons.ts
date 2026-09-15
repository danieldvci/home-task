import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Clock,
  CornerDownRight,
  FastForward,
  Minus,
  UserX,
  X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StateGlyph } from '../lib/schedule-view';

/**
 * The component-layer half of `statePresentation`.
 *
 * `lib/schedule-view.ts` names a glyph rather than importing one, so that
 * module stays free of React and keeps running under `tsx` in the test suite.
 * This is the only place a name becomes a component, so the day list, the week
 * grid and the grid's legend cannot pick different icons for the same state.
 */
export const STATE_ICONS: Readonly<Record<StateGlyph, LucideIcon>> = Object.freeze({
  none: Minus,
  clock: Clock,
  alert: AlertTriangle,
  forward: FastForward,
  check: Check,
  x: X,
  userX: UserX
});

/** A day that was dragged onto this one, and a day that was traded for it. */
export const MOVED_ICON = CornerDownRight;
export const TRADED_ICON = ArrowRightLeft;
