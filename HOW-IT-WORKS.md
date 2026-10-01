# How it works

What the app does and why it is built this way. [README.md](README.md) covers
running it; [ROADMAP.md](ROADMAP.md) covers what is deliberately not built yet.

This document describes rules, not code. Names of modules appear where a reader
would want to go next, but nothing here should need editing because a function
moved.

## What it is

A household shares recurring chores. The app decides whose turn each chore is on
each day, records what was actually done, and shows the result as a day list and
a week grid. It is in Hebrew, right-to-left, and installable as a PWA.

The hard part is not the list. It is that people go away, swap turns, forget a
day, and then argue about whose fault it was. Most of the design below exists to
make yesterday's answer stay true.

## There is no server

Everything runs in the browser against Firestore. There is no backend process,
no scheduled job, and nothing that wakes up at midnight.

The consequence worth internalising: **state is derived on read, not written.**
Whether a day is overdue, who owes it, and what is outstanding are all computed
from stored facts every time they are displayed.

Persisting them instead would mean some browser has to write the record. Which
browser? Several open tabs would race to write the same one, and a household
that did not open the app that week would leave holes in its own history. A
derived answer costs nothing to compute and cannot drift.

Stored facts are only the things a person actually did.

## The data

One Firestore document tree per household, at `households/{id}`:

| Collection | Holds |
|---|---|
| the household document | name, `ownerId`, `members`, `managerIds`, `setupComplete` |
| `users` | resident profiles: name, colour, photo or icon, absence window |
| `chores` | the schedule, the rotation, and every recorded day |
| `logs` | the activity feed, with photos, reactions and comments |

Two distinctions are easy to get wrong.

**A resident is not an account.** A `users` document is a profile in the
household. Some are linked to a Google account, some are not, so a shared tablet
in the kitchen can act as any of them. Every log record therefore carries both
`userId`, the resident it is attributed to, and `actorUid`, the Google account
that actually wrote it. The security rules verify `actorUid`, so nobody can
write a record as someone else even though anyone can act as any profile.

**There are two elevated roles, not one.** Any member may mark a chore done.
Everything past that splits in two:

| Role | Who | May |
|---|---|---|
| Manager | the owner, plus any account in `household.managerIds` | Skip, swap, write a day off, move and trade days, edit chores and residents, prune history, upload a resident's photo |
| Owner | `household.ownerId` | All of the above, plus renaming the home, disconnecting a member, and handing out the manager role |

A co-manager exists because one person doing all the marking is the failure the
app was built to end. Handing out the role stays the owner's alone, or a
co-manager could promote themselves past every limit the role still has.

Only an account can hold the role. A local profile is a face on a shared phone,
not something the security rules can check, so `managerIds` is validated as a
subset of `members`. `isManager` in `firestore.rules` also re-checks membership
rather than trusting the list, because disconnecting somebody and pruning
`managerIds` are two separate writes and the role must count for nothing in
between.

Both fields are read with a default, so a household written before co-managers
existed — which has neither key — still answers for its owner.

## The first run

A household that has just been created has one resident and no chores, and
finding where to add either meant going three taps into a collapsed settings
section. A new home now opens `components/HouseholdSetup.tsx` instead: name the
home, list who lives there, tick the chores you actually do.

`setupComplete` decides whether that happens, and the polarity matters. Only
`false` means "has not been through the wizard"; a **missing** field means an
existing household, which already has chores and must never be sent back to the
start. `createHousehold` is the only thing that writes `false`.

The wizard writes nothing itself. `buildSetupPlan` in `lib/household-setup.ts`
turns the draft into documents, the page commits residents, chores and the flag
in one `writeBatch`, and a failure leaves the draft on screen to retry — so a
household is never left with residents but no chores.

## Faces

A resident is drawn, in this order, as their photo, then their icon, then the
first letter of their name; `components/Avatar.tsx` is the only thing that
decides. A chore is drawn with its icon.

What a document stores is a short name like `dishes` or `rocket`, never a
component and never an image — the value round-trips through Firestore and the
rules can only check a string. `lib/default-icons.ts` owns the names and
`components/default-icons.tsx` turns them into Lucide components, the same
split as `statePresentation` and `components/state-icons.ts`, for the same
reason: `lib/` has to keep running under `tsx` in the test suite.

Nothing is migrated. A chore with no stored icon is drawn from its name, and a
resident with none from a hash of their id — which is why renaming somebody
does not hand them a different face. That also covers a name written by a later
build that this one does not know.

## How a turn is decided

Three rules drive the whole rotation engine, and they live in `lib/rotation.ts`:

1. **A completed occurrence is frozen** to the person recorded against that day.
   It never follows the rotation pointer and never reacts to a later absence. A
   trip booked next week cannot rewrite who did the dishes yesterday.
2. **An uncompleted occurrence still to come is projected** forward from
   `chore.currentIndex`, consuming one turn per open occurrence and skipping
   residents whose absence window covers the day that occurrence lands on.
3. **An uncompleted occurrence already past stays with whoever owes it.** The
   pointer moves only when somebody records something, so a day nobody touched
   handed the turn to nobody: the resident it came round to is still carrying
   it, and carries it until they do it or are skipped.

So `currentIndex` means "who takes the next open occurrence", and the recorded
days are fixed points the projection re-anchors on as it walks past them.

The asymmetry in the middle is deliberate. A day still to come is a forecast and
assumes the ones before it get done, so the queue spreads across it. A day
already gone is not a forecast; it is a debt, and it belongs to one person. That
person is read off the next record written on or before today — they were
holding the turn right up to the moment it was written — or off `currentIndex`
when nothing has been recorded since. Never from a walk backwards out of today:
the number of occurrences between a past day and today grows every night, so a
missed day used to be shown against a different resident each morning.

Whether a chore occurs on a given day at all is decided by three fields:

- `frequency` is `daily`, `weekly`, `custom_days`, or `once`. Weekly repeats
  every seven days from `anchorDate`; `custom_days` lists weekday numbers;
  `once` occurs on `onceDate` and then never again.
- `anchorDate` is what a repeat counts from, fixed when the chore is created.
  Without it a weekly chore has nothing stable to repeat from.
- `startDate` is the first day the chore exists. This is why adding a chore on a
  Thursday does not immediately show three missed days earlier that week.

Absence is a datetime range, `absentFrom` to `absentUntil`, evaluated per day
rather than as a flag. The boolean `isAbsent` is still written alongside it as a
mirror of "away right now", for the security rules and for older readers, but no
rotation decision reads it.

## What a day can be

Every chore-and-day pair resolves to exactly one state. Both views render from
the same resolution in `lib/schedule-view.ts`, which is why they cannot disagree
about a date.

```mermaid
flowchart TD
  Occurs{"Does the chore occur that day?"}
  Occurs -->|no| NoneState["none"]
  Occurs -->|yes| Record{"Completions record for the day?"}
  Record -->|done| DoneState["done, frozen to whoever did it"]
  Record -->|cancelled| CancelledState["cancelled, written off"]
  Record -->|"skipped, or nothing"| Owned{"Does a present resident hold the turn?"}
  Owned -->|no| Unavailable["unavailable"]
  Owned -->|yes| Passed{"Has the day passed?"}
  Passed -->|yes| Overdue["overdue"]
  Passed -->|no| Open["open"]
```

`unavailable` means the turn landed on nobody who can take it: the rotation is
empty, everyone in it is away, or the resident holding it has been deleted.

The question that actually matters is **which states still owe work**. `done`
and `cancelled` are settled. `overdue` is owed, and today's card says so with a
carry-over badge tracing up to two weeks back.

**A skip is not a state, and it does not settle anything.** Skipping hands the
turn to the next resident and leaves the day itself open, so it still reads as
open or overdue and is still owed. Cancelling is the only way to write a day off
without claiming it was done. Without that distinction, an occurrence nobody
ever got to would stay outstanding forever.

## What you can do to a day

The whole of a chore's mutable state is `completions`, a map keyed `YYYY-MM-DD`,
plus the `currentIndex` pointer. Every action below is a write to one or both,
and each is also appended to the activity log.

| Action | Who | Effect |
|---|---|---|
| Mark done | the assignee, or a manager | Records the day against the person, moves the pointer on. Optional proof photos. |
| Undo done | whoever completed it, or a manager | Removes the record and returns the pointer to them. |
| Skip | manager | Records the day as skipped and moves the pointer on. The day stays owed. |
| Undo skip | manager | Removes the record and returns the turn. |
| Write off | manager | Records the day as cancelled against whoever owed it. Takes no turn, so the pointer is untouched. |
| Undo write-off | manager | Removes the record; the day is owed again. |
| Move a day | manager | Drag a day in the week grid onto an empty one. The occurrence stops falling on the first and starts falling on the second, keeping the resident who owed it. |
| Trade two days | manager | Drag a day onto another resident's day in the same row. Both keep their occurrence and the two residents exchange them. |
| Swap | manager | Exchanges two residents' positions in the rotation. Note this is permanent, not a one-day trade. |
| One-off task | manager | Creates a `once` chore on the day being viewed, for an extra round of something. |
| Manual entry | any member | Writes a log record with no chore behind it. |

Marking done is one tap: the button records the day for whoever is named on the
card. The camera beside it is the longer route, for a photo or for crediting
somebody else. Undo is on the card afterwards, which is what lets the quick
path be quick — nothing it does is hard to take back. Writing a day off asks
first, because that one is not a completion and quietly ends the day.

Whoever is holding the phone acts for whoever is selected, which is the point:
a resident with no phone of their own gets marked off from the kitchen tablet.
The profile switcher sits above the task list so it takes one tap to change who
the next completion is credited to, and the tasks are filtered to them.

Completing or skipping a future day deliberately does not move the pointer, so
finishing Saturday's turn early cannot steal the turn from the days in between.

Moving and trading are the two that do not settle a day, they only relocate it.
Each writes a linked pair of records, and the pair between them consumes exactly
one turn, so neither changes what the rotation does on any other day. A traded
day in particular keeps the queue where it was even after it is completed:
taking Monday off someone is a favour, not a claim on Tuesday as well.

Dragging is disabled while a person filter is on, because the grid draws another
resident's day as an empty cell and that would look like free space.

Marking done, undoing, skipping and writing off all run inside a Firestore
transaction, re-deciding against the stored document. Two people finishing the
same chore at once would otherwise each write back a whole completions map built
from their own stale copy, and one would silently drop the other's day.

Every action applies to the day being viewed, not to today.

## The three tabs

**Tasks** shows a day list and a week grid. Both are built by one call to
`buildScheduleRows`, through one shared set of filters, so whatever the grid
shows in a column is what the day list shows for that date.

**History** shows a per-person activity chart above the log feed. The chart
counts `chore.completions`, not the log. The log is the wrong source for
statistics: it is capped at the most recent records with no date filter, and it
is append-only, so undoing a completion writes a second record rather than
removing the first. Anything that answers "who did what" reads the completions
map.

**Settings** covers residents, chores, absence windows, household membership,
manager roles and reminders. Controls a member may not use are hidden rather
than greyed out: a phone has no hover, so a disabled control there has no way
at all to say why it is disabled.

## Limits worth knowing

- **History has a floor.** A chore's completions are pruned on write, to 180
  days or 366 entries. It is also ragged rather than a clean line, since pruning
  only runs when that chore is written to: a chore in daily use loses old days
  that a dormant one still keeps.
- **The log feed is the most recent 200 records**, with no pagination. A wide
  date range can outrun it, and the history tab says so when it does.
- **Turn ownership is client-side.** Rotation is projected from data that
  security rules cannot compute, so any member can drive the queue through the
  SDK. Identity is bound and every action is logged, so nobody can act as
  someone else, but the queue itself is not enforced.

`ROADMAP.md` has the rest of the known limitations and the reasoning for the
features that are deliberately absent.
