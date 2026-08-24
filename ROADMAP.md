# Roadmap

Written after a full audit of the project against the household-chore apps on
the market. Everything here is deliberately **not** built yet. It exists so the
reasoning is not lost, not as a commitment.

## Where this app is already ahead

- **Per-day completion freezing.** A finished day is pinned to the resident who
  finished it. A later absence, a later edit, or someone else's turn cannot
  reassign work that is already done. Most competitors recompute from a single
  pointer and quietly rewrite history.
- **Absence as a real datetime range.** `absentFrom`/`absentUntil` are evaluated
  per day, so a trip next week does not change who owed the dishes yesterday.
- **Photo proof, reactions and comments** on the activity log, which turns the
  history into something people actually read.
- **Hebrew and RTL first**, installable as a PWA, and free with no per-seat tier.

For comparison: Flatastic and Chap rotate strict round-robin with no concept of
a frozen day; Sweepy and Tody are strong on scheduling and "task decay" but do
not model rotation between people at all.

## Table stakes we are missing

1. **Reminders that arrive when the app is closed.** Today's reminders are local
   notifications fired by an open tab. Real delivery needs Firebase Cloud
   Messaging plus a scheduled Cloud Function and a VAPID key, which is
   infrastructure work outside this repository. On iOS in particular, nothing
   arrives in the background today, and the settings copy now says so plainly.
2. **Effort-weighted fairness.** Every competitor that markets fairness (this is
   Tidywell's entire pitch) weights chores by effort rather than counting them.
   Our leaderboard counts completions, and only from the 50 logs currently
   loaded, so it is both unfair and wrong. A `weight` on the chore plus a
   server-side tally would fix both.
3. **Paginated history.** The log view stops at 50 entries. Anything older is
   invisible in the UI even though it exists and is still deletable.

## Second tier

- **Cover requests**: ask a housemate to take a turn without needing an admin to
  swap. Today only the household owner can move a turn.
- **Shared shopping list**, the single most requested companion feature in this
  category.
- **Per-chore checklists** and a starter template pack, so a new household is
  not staring at an empty screen.
- **Expenses with running balances**, which is how Flatastic keeps flatmates in
  the app between chores.

## Known limitations, kept deliberately

- **Turn ownership is client-side.** Rotation is projected from the completions
  map and absence windows, which security rules cannot compute, so any member
  can drive the queue through the SDK. Identity is bound (`actorUid` must equal
  the caller), so nobody can act *as someone else*, and every action is logged.
  For a household app that is the right trade; enforcing turns server-side would
  mean moving completion into a Cloud Function.
- **The household document is readable by any signed-in user who knows its id.**
  The join flow needs it before the joiner is a member. The fix is a separate
  join-code document holding only what the join screen needs.
- **Photos taken offline are dropped.** Firestore queues writes offline, but
  Storage has no offline queue, so a completion made without a connection saves
  the chore and loses the picture.
- **No sync indicator**, so a queued offline write looks identical to a saved one.

## Smaller carried-over items

- Accessibility: modal focus trap and Escape-to-close, `role="alert"` on toasts,
  accessible names on the remaining icon-only buttons.
- Service worker does not prompt a reload when a new version activates.
- Unused dependencies: `@google/genai`, `@hookform/resolvers`,
  `class-variance-authority`.
- `sharp` is missing, so the icon generation script cannot run.
- Dead code: `hooks/use-mobile.ts`, `lib/utils.ts`.
- `.env.example` documents variables no code reads.
