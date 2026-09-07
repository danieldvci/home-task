# Defects

A working list so the next session knows what is still broken. New items go
under **Open**. When a fix lands, move the item to **Fixed** with the date.

## Open

### Save does nothing and never says why — reported 2026-09-02

A Save click that fails validation returns silently: no toast, no message on
the field, nothing moves. The user is left guessing which field is at fault, or
whether the app is broken.

Places that behave this way today:

| Where | Silent when | Code |
|---|---|---|
| Chore form, "שמור משימה" | name empty, or nobody on the rotation | `handleSaveChore` in `app/page.tsx` |
| Resident rename, the check button | name empty | `handleSaveUserEdit` in `app/page.tsx` |
| Add local resident, the check button | name empty | `handleSaveNewUser` in `app/page.tsx` |

The chore form does raise a toast for one case — custom-days frequency with no
weekday selected — so it is only the guard in the first `if` that is silent.

Two related places hide the reason a different way, by leaving the button
disabled with nothing explaining what is missing: the quick one-off task modal
and the manual log modal (`components/TaskModals.tsx`), plus rename-home and
join-by-code in settings.

Suggested handling when this is picked up: keep Save clickable, show the reason
inline on the offending field (`role="alert"`, red border, `aria-invalid`),
move focus there, and repeat it in a toast for anyone who has scrolled past.
The toast helper already exists as `showToast` in `components/Toast.tsx`.

### A day can be dragged into the past — reported 2026-09-07

`dropTargets` in `lib/schedule-view.ts` only rejects days before the chore's
`startDate`, so an occurrence can be dropped onto a day that has already gone,
and two past days can be traded with each other. Neither resolves anything; it
rewrites history instead of rescheduling work.

Picking a past day *up* is correct and must stay. `isPickable` allows `overdue`,
and moving an unpaid debt forward to a day somebody can actually do it is the
main reason dragging exists. It is only the target side that needs a bound:
sources may be overdue, targets should be today or later.

### A day vacated by a move never accepts a drop again — reported 2026-09-07

Moving an occurrence off a day leaves a `movedTo` record behind on it. The day
then resolves to `state: 'none'`, but the empty-day branch of `dropTargets`
requires `!getDayRecord(chore, cell.day)`, so it is never offered as a target
again. It looks like free space in the grid and silently refuses every drop.

The guard itself is deliberate — landing there would leave the same day both
suppressed and relocated onto. The fix is to let the drop clear the old
relocation, or to mark the day so it does not read as free.

## Fixed

_(none yet)_
