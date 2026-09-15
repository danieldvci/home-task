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

## Fixed

### A long resident name cropped the task name off the card — fixed 2026-09-14

The day-list card header was one flex row holding the task name and the assignee
chip. The chip carries a `תור:` label, up to five avatars and a name, none of
which can shrink, and only the name block had `min-w-0` — so the title was the
only thing in the row that could give way. A household with a resident called
"Amaranta Cohen" saw a card whose heading was a single letter, which left the
card unable to say which chore it was.

The task name now has its own full-width line and wraps rather than truncates,
and the assignee moved to the row below it. The chip's width cannot reach the
title at all now, so no name length or rotation size can reproduce this.

The same inversion was in the complete, skip and swap dialogs, where a generic
question ("סיימת את המשימה?") was the heading and the task name was the
smallest, faintest text on screen — three dialogs that opened identically. The
task name is the heading in each, and the question is the line beneath it.

### A day can be dragged into the past — fixed 2026-09-08

`dropTargets` in `lib/schedule-view.ts` only rejected days before the chore's
`startDate`, so an occurrence could be dropped onto a day that had already gone,
and two past days could be traded with each other. Neither resolved anything; it
rewrote history instead of rescheduling work.

Targets are now floored at today. Picking a past day *up* is unchanged, and had
to be: `isPickable` allows `overdue`, and moving an unpaid debt forward onto a
day somebody can actually do it is the main reason dragging exists. Sources may
be overdue, targets may not.

### A day vacated by a move never accepts a drop again — fixed 2026-09-08

Moving an occurrence off a day leaves a `movedTo` record behind on it. The day
then resolves to `state: 'none'`, but the empty-day branch of `dropTargets`
requires `!getDayRecord(chore, cell.day)`, so it was never offered as a target
again — it looked like free space in the grid and silently refused every drop.

Fixed the second of the two ways suggested: the day now says it is occupied
rather than pretending to be free. `ScheduleCell` carries `vacatedTo`, and the
grid draws such a day with the relocation glyph instead of the dot it shares
with genuinely empty days. The refusal itself was deliberate and stays, because
landing there would leave the same day both suppressed and relocated onto.

### The week grid's legend disagreed with the week grid — fixed 2026-09-08

The legend was written out beside the map it explained rather than generated
from it, so it drifted: it drew an overdue day as `bg-rose-500` where the cell
was `#B9553D`, and called it `לא בוצע` where the grid's own tooltip said
`ממתין` and the day list said `באיחור`. Three vocabularies for six states.

Both now resolve through `statePresentation` in `lib/schedule-view.ts`, and the
legend is generated from the same table, so a divergence has to be introduced
in one place to exist at all.

### A refusal that could not be asked why — fixed 2026-09-08

`AdminHint` explained an owner-only control through a `title`, but the controls
it wraps carry `disabled:pointer-events-none`, and a phone has no hover at all —
so a member saw a row of greyed-out controls with no way to find out why. The
wrapper now takes the tap and answers with a toast.

### A completion could be backdated by leaving the tab open — fixed 2026-09-08

Every action writes to the day being viewed, and the selected day was held as a
date. A tab left open overnight stayed pinned to a yesterday that had quietly
become overdue, while the day strip re-anchored around the new today — so the
first tap the next morning recorded a completion against the wrong day.

The selection now follows today unless the user picked a day, and the day being
acted on is named in a sticky heading that turns amber when it is not today.
