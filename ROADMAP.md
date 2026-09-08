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
- **Something happens when you tap done.** Today the card turns green and that
  is the entire reward. A short celebration — a line of praise, a two-second
  animation, an optional chime — is most of what separates a chore list a child
  opens on purpose from one a parent has to nag them into. Notes for whoever
  builds it:
  - Vary the line and key it off something true: first task of the day, three
    days running, covering somebody else's turn. A fixed `כל הכבוד` every time
    stops registering inside a week.
  - Derive any streak or milestone on read from `chore.completions`, like
    everything else here. A stored counter would have to be written by whichever
    tab happened to be open, which is exactly the trap `missedOccurrences`
    exists to avoid.
  - `motion/react` is already a dependency, so the animation needs no new
    package. Honour `prefers-reduced-motion` and skip it.
  - Sound is allowed to start, because the tap is a user gesture. But the web
    cannot tell whether the phone is on silent, so it needs its own toggle
    beside the reminders one in Settings and should default to off.
  - Prefer an inline SVG or a `motion` sequence over a video or a Lottie file.
    This installs as a PWA, so the payload is paid on first load by every
    household, for two seconds of animation.

## The redesign

The engine is right and the screen does not always say so. Everything in this
section is about the second half of that sentence: `resolveDayAssignee` already
knows who owes Tuesday and why, and a resident looking at Tuesday often cannot
tell.

Principles first, because the concrete proposals are only worth keeping while
the reasoning under them holds. Anything already tracked as a bug stays in
`DEFECTS.md`; this section does not restate it.

### What has landed

On `redesign/v0.2`. The reasoning for each now lives with the code it explains,
which is the only place it stays true, so it is not repeated here:

| Landed | Where the reasoning is |
|---|---|
| One schedule pass per render, memoised on `dayKey(today)`; residents indexed rather than searched | the `schedule` memo in `app/page.tsx`, `Residents` in `lib/rotation.ts` |
| A cost budget that counts lookups instead of timing them | the last block of `scripts/schedule-view.test.ts` |
| The palette named by role | `@theme` in `app/globals.css` |
| `statePresentation` — one table deciding a state's surface, badge, dot, glyph and word, with the week grid's legend generated from it | `lib/schedule-view.ts` |
| A skip drawn as a modifier on a state rather than a state | `isHandedOn`, same file |
| A summary line, and the acted-on date pinned and named | `DayHeading` in `app/page.tsx` |
| The selected day following today unless picked, so an overnight tab cannot backdate a completion | `pinnedDate`, same file |
| A refusal that answers on tap | `AdminHint`, same file |
| 44px grid cells, legend above the grid, both `dropTargets` defects | `components/WeekOverview.tsx`, `DEFECTS.md` |

Still open below: the single filter bar, demoting skip and swap out of the card's
action row, inverting the confirmation policy, the member "ask" affordances,
splitting `app/page.tsx`, and all of History and Settings.

### The test every change here has to pass

This is a chore list for a family, opened for a few seconds while someone is
standing in a kitchen, sometimes by a child. It is not a project manager. So
one question governs everything below, and outranks every principle after it:

**Can a resident open the app and know what to do without being taught?**

That sets the bar in a specific place. A resident should reach their own tasks
with no taps at all, and finish one with a single tap. Nothing they need should
be behind a filter they have to set, a colour they have to look up, or a
gesture they have to discover. The sophistication in this app is real and it
belongs to the engine, not to the screen: rotation projection, frozen days,
absence windows and relocated occurrences are all things the app should know so
that nobody has to think about them.

Two consequences worth stating, because they are what make the proposals below
subtractive rather than additive:

- **Every proposal here should remove something.** Merging three filter strips
  into one bar, moving skip and swap off the card, folding two colour
  vocabularies into one. If a change only adds, it is the wrong change.
- **Owner power is not resident complexity.** Moving days, trading days and
  writing days off are correct features and they belong out of the everyday
  path. A member should never see a control they cannot use.

### What any app of this kind has to get right

**One primary action, one size.** A screen should have a single obvious thing to
do, at a size a thumb finds without aiming, and everything else should be
visibly secondary. An open card today offers up to five buttons of which three
are icon-only squares of the same weight, so "done", "skip" and "swap the
rotation for good" read as peers. They are not: one is the daily act, one is a
correction, one is permanent.

**Recognition, not recall.** Nothing should require the user to remember a rule
the app already knows. Five colour-coded states with the key printed at the
bottom of a different view is recall. So is a greyed button whose only
explanation is a `title` attribute.

**The system says what happened.** Every action gets a visible result, every
refusal gets a reason, and anything in flight looks like it. Save that fails
validation and returns silently is the sharp end of this and is already filed;
the general rule is that a control the app will refuse should not look
identical to one it will accept.

**Reversible before confirmable.** Undo beats a dialog. A dialog on a
reversible action is a tax on the common case, and a dialog on everything
trains people to dismiss dialogs. The app currently has this backwards in
both directions at once: marking done — the most frequent, most reversible act
in the app — costs a confirmation modal, while writing a day off, which
rewrites the record and which only the owner can undo, goes through on one tap
with no confirmation at all.

**Progressive disclosure with an honest floor.** Hide complexity, but never the
thing someone came for. Collapsing Settings is right; collapsing "add a chore"
behind a closed section on the setup screen is not.

**Defaults are the product.** Most people never touch a setting. The default
filter, the default tab and the default day decide what the app is.

### What this app in particular has to get right

#### Right-to-left is a direction, not a stylesheet

`dir="rtl"` on `<html>` is set and correct, and the interesting cases are the
places that deliberately opt out. Avatar queues and the rotation reorder arrows
use `dir="ltr"` islands; the week grid resolves drops with `elementFromPoint`
plus `data-day-index` specifically so no code has to reason about which
direction a positive x-offset means. Those are good instincts and the rule they
imply should be written down:

- **Time and sequence run right-to-left.** Sunday is the rightmost column, the
  oldest bar in the activity chart is on the right, `ChevronRight` means
  *previous*. All three are already right; they are also all easy to break, so
  they belong in a test rather than in a reviewer's memory.
- **Never derive direction from geometry.** Prefer logical properties
  (`ps-*`/`pe-*`, `start`/`end`) over `left`/`right`, and prefer hit-testing
  over coordinate arithmetic. The grid already does the second.
- **Numbers, times and codes are LTR runs inside RTL text.** Dates, the house
  code and counts need `tabular-nums` and an explicit direction, or a code like
  `A1B2` will render in an order nobody can read aloud.
- **Icons that mean direction must mirror; icons that mean an object must not.**
  A chevron mirrors. A camera does not.

#### Owner and member are two different products

`isAdmin` is `household.ownerId === user.uid`, and it currently gates roughly
twenty controls through one pattern: render the control, `disabled`, at
`opacity-40 pointer-events-none`, with the reason in a `title`.

That pattern cannot work on the primary platform. `pointer-events-none` means
the element receives no hover and no tap, so on a phone the string
`רק מנהל הבית יכול לבצע פעולה זו` is unreachable: there is no gesture
that displays it. A member sees a screen of ghosted controls and is given
no way to find out why. The week grid is worse in the other direction: for a
non-owner the rearrange affordance is simply absent, and the explanatory banner
is only passed when `isAdmin`, so the feature does not exist and nothing says
it once did.

The principle: **a member's screen should be a complete screen, not an owner's
screen with the lights off.** Two consequences.

- Controls a member can never use should not be rendered as furniture. Either
  drop them from the member's layout, or replace them with the thing a member
  *can* do — which is ask.
- Where the app must refuse, the refusal has to be a tappable surface that
  answers on tap. A `title` on an inert element is not an explanation.

This is also where the biggest flow gap sits. In a real household the owner is
one person with a phone, and skipping, moving a day, trading two days and
writing a day off are all theirs. Everyone else's only move is to do the chore
or leave it undone. **Cover requests** is already on the second tier; the
redesign should treat it as the thing that makes the member screen coherent,
because it converts every one of those dead controls into a request.

#### Derived state changes what the UI owes the user

Because nothing is written at midnight, the screen is always an opinion formed
at render time, and two consequences follow that the current UI does not handle.

**The viewed day is not today, and the app acts on the viewed day.** Every
action applies to `selectedDate`. The day strip is the only place that date is
named, and it is not sticky, so scrolling two cards down leaves a full-width
green `בוצע` button with nothing on screen saying which day it will record. The
worst case is real and specific: `today` is recomputed on a minute tick, so a
tab left open overnight rolls `today` forward while `selectedDate` stays pinned
to yesterday, the strip re-anchors around the new today, and the first tap next
morning backdates a completion to a day that has meanwhile become overdue. The
date being acted on has to be visible at the moment of acting, and a rollover
has to be announced rather than absorbed.

**A derived answer needs its provenance shown, not just its result.** The
engine knows *why* a day landed where it did — projected from `currentIndex`,
frozen by a completion, relocated by `movedTo`/`movedFrom`, handed over by
`assignedTo`, or unowned because everyone is away. `ScheduleCell` already
carries `rearranged` and `movedFrom` for exactly this. Today that reasoning
reaches the user as a 12px badge in the grid and nothing at all in the day
list. Since the app's entire pitch is ending the argument about whose turn it
was, the answer has to be able to show its work.

**And a stale tab is indistinguishable from a fresh one.** No sync indicator is
already a known limitation; under derived state it is sharper than it looks,
because a stale tab is not blank, it is confidently wrong.

#### Five states, and one of them is not a state

`CellState` is `none | open | overdue | done | cancelled | unavailable`, and a
skip is deliberately not among them: skipping hands the turn on and leaves the
day owed, so it still resolves as open or overdue. That distinction is the
subtlest true thing in the app and it currently has the weakest presentation of
anything on the card.

Where the rendering actually stands:

| State | Day list surface (`CARD_SURFACE`) | Week grid |
|---|---|---|
| `none` | white — same as `open` | grey `·` |
| `open` | white — same as `none` | bare avatar, no badge |
| `overdue` | red-tinted, `באיחור` badge | `#B9553D` dot with `!` |
| `done` | green-tinted, `בוצע` bar | `#A1C181` dot with a check |
| `cancelled` | `#F5F1EA` — same as `unavailable` | greyed avatar, `#A39788` dot with an X |
| `unavailable` | `#F5F1EA` — same as `cancelled` | `UserX`, no avatar |
| skipped | 11px `#A39788` meta line | nothing |

Four defects fall straight out of that table:

1. **`open` has no visual identity**, because its surface is byte-identical to
   `none`. The state that describes almost every card carries no signal.
2. **`cancelled` and `unavailable` share a surface** while meaning opposite
   things — one is a decision somebody made, the other is the app reporting it
   has nobody to ask. They are told apart only by a badge and a footer line.
3. **A skip is invisible in the grid and near-invisible on the card**, where the
   fact that the turn moved to someone else is carried by the lowest-contrast
   text in the layout.
4. **The two views use different words and different colours for the same
   states.** The day list says `באיחור` and `בוטל`; the grid legend says
   `לא בוצע` and `נסגר`. The legend swatch for overdue is `bg-rose-500`
   while the cell it explains is `#B9553D`, so the key does not match its
   own map.

`buildScheduleRows` exists so the two views cannot disagree about a date. There
is no equivalent guarantee that they cannot disagree about how a date *looks*,
and they currently do.

The principle: **settled and owed is the first distinction the eye should make,
and it should never be carried by colour alone.** `done` and `cancelled` are
settled; `open`, `overdue` and a skipped day are owed; `unavailable` is owed by
nobody and is the app's problem, not the household's. Each state needs a shape
or a glyph as well as a hue — this is a household app used by children, in a
category where red/green is the obvious palette and also the most common
colour-blindness axis.

### Proposals

#### The visual language

The palette is genuinely good and completely undocumented. `globals.css` is one
`@import` line, so 39 distinct hex values live inline in Tailwind arbitrary
values, plus Tailwind's own named colours (`rose-500`, `amber`, `emerald`) mixed
in at 17 sites. That is why the grid legend drifted from the grid.

- Promote the palette to Tailwind v4 `@theme` tokens in `app/globals.css`
  (already on 4.1.11, so `@theme` needs no new tooling). Name by role, not by
  colour: `--color-surface`, `--color-ink`, `--color-owed`, `--color-settled`,
  `--color-elevated`. The two Tailwind-named strays get folded in.
- Extend the single existing state map into the one place state becomes
  appearance. `CARD_SURFACE` in `app/page.tsx` already maps `CellState` to
  classes for one of the two views; the replacement should live beside
  `buildScheduleRows` in `lib/schedule-view.ts` and return the whole
  presentation — surface, glyph, Hebrew label, owed-or-settled — so the day
  list, the grid, the grid legend and the History action pills all read one
  source. This is the same argument the module header already makes about
  layout, applied to appearance.
- Give each state a glyph as well as a tint, and use one Hebrew label per state
  everywhere. Pick the labels for a resident, not a maintainer: `להשלמה`,
  `באיחור`, `הועבר הלאה`, `בוצע`, `ויתרנו`, and `אין דייר זמין`.
- Fix the type gap behind the fourth defect: a skipped day is a distinct thing
  to render and currently has nowhere to be named. Add a presentational
  discriminator — `overdue` plus `handedOn`, or a derived `displayState` — so
  "the turn moved and the day is still owed" is expressible rather than
  reconstructed from `assignment.skippedBy` by each reader independently.
- Two type scales only, and a minimum body size of 14px. The card currently
  runs from `text-lg` down to `text-[10px]`, and the 10px and 11px text is
  carrying meaning, not decoration.
- Every tap target at 44px. The grid's are 28px inside 36px columns.

#### Tasks — the day list

The problem is the top of the screen. Three horizontally scrolling chip strips
(person, category, and the day strip) plus a `MultiSelectFilter` plus the
day/week toggle stack above the first card, so on a phone the answer to "what do
I have to do" is below the fold behind five rows of controls — and the person
strip is hand-rolled while the chore filter beside it and the person filter on
History both use `MultiSelectFilter`.

- **Lead with the answer.** Above the controls, one line derived from the same
  rows: whose turn it is, how many are owed today, whether anything is carried
  over. If a resident reads one thing, this is it.
- **Collapse the controls to one row.** A single filter bar showing the active
  filter in words (`המשימות שלי`, `כל הבית`, `מטבח`) that opens a sheet holding
  person, chore and category together. Two of the three strips disappear from
  the resting state. This also finishes the conversion already scoped in the
  smaller items below, including `personId` becoming `personIds: string[]`.
- **Pin the date being acted on.** Make the day strip — or at minimum a compact
  date header carrying `relativeDayLabel` — sticky under the app header, styled
  differently when the selection is not today. This is the single highest-value
  error-prevention change in the app, because every action writes to the viewed
  day and today's rollover moves that day out from under a long-open tab.
  Announce a rollover in place rather than silently re-anchoring the strip.
- **Rank the actions by frequency and consequence.** `בוצע` stays the full-width
  primary. Skip and swap leave the card surface for an overflow menu, since one
  is occasional and the other is permanent — and label them, because
  `FastForward` and `Repeat` are not self-evident icons for "hand the turn on"
  and "reorder the rotation for good".
- **Invert the confirmation policy.** Drop the modal on `בוצע` and make the tap
  immediate with undo in the toast; keep the camera as an optional affordance on
  the completed card rather than a gate in front of finishing. Add a
  confirmation to writing a day off, which is the destructive one. This also
  clears the way for the celebration on the second tier: a tap that resolves
  instantly has somewhere to put a reward, and a tap that opens a dialog does
  not.
- **Show the provenance inline.** When a cell is `rearranged` or has
  `movedFrom`, say so on the card in words — `הועבר מיום שלישי`,
  `התחלפתם ביניכם` — not only as a grid badge. `relativeDayLabel` already
  phrases this.
- **Give the member something to do.** Where a member currently reads
  `ממתין ל־{name}` with no controls, offer "I'll cover this" and "ask someone to
  swap". Those are requests, not writes to the rotation, so they fit the
  security model as written.

#### Tasks — the week grid

The grid is the most sophisticated part of the UI and the least explained. It
encodes six states in 12px badges on 24px avatars in 36px columns, and its
headline interaction is invisible in the default state — because the default
person filter is `my_tasks`, and `canRearrangeWeek` requires `personId === 'all'`.
A new owner's first visit therefore has dragging silently switched off; a
non-owner never gets the banner at all.

- **Do not ship a default that disables the feature.** Either let the grid
  default to all residents while the day list stays personal, or keep the filter
  and surface the trade in the grid header rather than in a banner that only
  owners are passed.
- **Widen the cells and let them carry state legibly** at 44px, with the glyph
  from the shared state map rather than a bespoke badge, so the legend cannot
  drift from the grid again.
- **Move the legend above the grid, or make it a header affordance.** A key
  below a horizontally scrolling table is a key nobody has read at the moment
  they needed it.
- **Keep pick-and-place as the primary path, not the fallback.** The long-press
  and `Shift+Enter` path already works and is more discoverable and more
  forgiving than a horizontal drag inside a horizontally scrolling table. Lead
  with tap-to-pick, tap-to-place; keep the drag for fine pointers.
- **Name the consequence before the drop, not just the target.** `העבר לכאן`
  and `החלף עם יום זה` are correct and are `title` attributes on a control the
  user's finger is currently on top of. Put the sentence in the held-mode
  banner, which is already on screen and already reserved for this.
- **Bound the targets** to today or later, per the open defect, and make the
  reason visible while holding rather than by silently offering fewer cells.

#### History

The tab is in good shape; the friction is scope. Three controls sit above the
content and they apply to different things — the person filter and the date
range drive both the chart and the feed, the chore filter drives only the chart
— and nothing on screen says which is which.

- **Label the scope where the control lives.** The chore filter is already
  inside the chart card; give the card a heading that says the filter stops
  there, and move the shared controls into a single bar with the other two.
- **Distinguish the log's action types by the shared state vocabulary**, not by
  a second palette. `ACTION_STYLES` currently defines nine badge styles in
  colours unrelated to the states they describe, and two real actions
  (`העברת יום`, `החלפת ימים`) fall through to the default and render as generic
  `Activity`. Deriving these from the same map fixes both.
- **Answer "who does more" without making the reader count bars.** The chart
  plots the right thing from the right source; add the one-line conclusion above
  it, since that is the question people open the tab to settle.
- **Say what the cap means in the reader's terms.** The truncation notice is
  accurate and abstract. "Older activity exists but is not shown here" is the
  useful version, and it should sit where the feed ends rather than reading as a
  footnote about record counts.

#### Settings

Six sections, five collapsible, one open by default — and the two things a new
household must do are the deepest. Adding a chore is three taps behind a
collapsed section; the chore form cannot express `once`, `startDate` or
`anchorDate` at all, so a chore silently starts today.

- **Split setup from settings.** A household with no chores does not need a
  settings screen, it needs the two setup steps. Promote "add a resident" and
  "add a chore" out of collapsed sections into a first-run path, which is also
  where the starter template pack on the second tier belongs.
- **Fix absence, which is the largest gap between the model and the UI.** The
  data layer stores a real datetime range, `setAbsence` accepts a window,
  `absenceWindowLabel` formats one, and the rotation evaluates per day — and the
  only control is a toggle that writes an open-ended absence from *now*. So the
  exact scenario the product page sells, telling the app in advance about next
  week's trip, cannot be entered. Give absence a from/until picker. The
  validation for `until <= from` already exists and is currently dead code.
  Then show upcoming absence on the resident row and in the week grid, since a
  planned absence changes who the grid says is on duty.
- **Let the chore form say what the chore actually is.** Expose `startDate`
  ("from when"), and state the derived `anchorDate` in words rather than
  leaving a weekly chore's repeat day implicit. A field the form cannot express
  is a field the user will not understand the effect of.
- **Make the member's Settings a member's Settings.** Residents and Task
  Management currently render owner controls ghosted with an explanatory line
  above them. Keep the line, drop the ghosts, and put "ask the manager" where
  the disabled buttons were.
- **Reorder by frequency of use.** Absence and the acting profile are touched
  often; household creation and join codes are touched once. The order is
  currently close to the reverse.

#### Performance, and what the redesign must not cost

Nothing above needs a new dependency, and that is the first budget. The shipped
client bundle is about 1.5 MB of JavaScript, of which the page's own chunk is
only 42 KB — the rest is Firebase and the React runtime. So the redesign cannot
make loading meaningfully worse by writing code, only by installing something.
`motion` and `lucide-react` are already dependencies, which covers animation and
every glyph the state map needs. A chart library, a drag library or a component
kit would each cost more than the entire feature. This is a PWA, so a household
pays that on first load, once, on whatever phone it owns.

The second budget is the render, and here the redesign is genuinely at risk,
because it adds readers to a computation that is already unmemoised.

`app/page.tsx` contains no `useMemo`, `useCallback` or `memo`. `renderTasks`
calls `buildScheduleRows` twice on every render, for the day rows and the week
rows, and a third and fourth time with `ALL_TASKS` to decide whether an empty
list means "nothing scheduled" or "nothing matches your filter" — those two are
`||` short-circuited, so they only run when a view is already empty. One of the
first two is always for the view that is not on screen. Each cell resolves through
`projectAssigneeIndex`, which walks the calendar one day at a time from today to
the day in question, and every occurrence it passes calls
`getActiveAssigneeIndex`, which does a `users.find` per rotation slot. On top of
that, each card that is open today calls `missedOccurrences`, which builds
fourteen more cells whose walks are up to fourteen days long.

So the cost is roughly `chores × days × walk × rotation × users`, recomputed
whole on every render — and the minute tick that keeps absence windows current
guarantees a full recomputation every sixty seconds in every open tab, forever.
It is fast enough today at household scale. It is fast enough by luck, not by
construction, and every proposal above adds another consumer: the summary line,
the provenance sentence, the state map, the filter sheet.

The rule: **the redesign may add readers of the schedule, but it must not add
passes over it.** Five things make that true, and all five are worth doing
before the visual work rather than after.

- **Do not build the view that is not showing.** The day rows and the week rows
  are both built regardless of `tasksView`. Halving this is a one-line change.
- **Stop asking the question twice.** The two `ALL_TASKS` passes exist only to
  choose an empty-state sentence, and resolve an assignee for every cell to do
  it. Whether anything is scheduled needs no assignee:
  `chores.some(choreOccursOnDate)` answers it for a fraction of the cost.
- **Memoise on the day, not on the `Date`.** `today` is a fresh object every
  render, so a `useMemo` keyed on it would never hit and the minute tick would
  defeat the whole exercise. Key on `dayKey(today)` and the tick becomes free
  except at midnight, which is precisely the rollover the sticky date header
  needs to notice anyway. One mechanism, two problems.
- **Index the residents once.** `users.find` runs inside the rotation loops in
  `getActiveAssigneeIndex`, `getPrevActiveIndex` and `isEveryoneAwayOnDay`.
  Passing a `Map<string, RotationUser>` removes a whole factor from the
  estimate above and changes no behaviour.
- **Let the state map be a lookup, not a constructor.** `statePresentation`
  runs per cell. It should select from a frozen record keyed by state and
  return plain class strings, not allocate a fresh object and compose classes
  per cell. `CARD_SURFACE` already has the right shape; keep it. A skip has to
  ride alongside a state rather than inside it, or the lookup becomes a
  constructor again to carry it.

Two things to add rather than optimise. The day list has no skeleton — the whole
app shows one spinner until Firestore answers — so the cheapest perceived-speed
win in the app is a card-shaped placeholder that makes the first paint look like
the thing that is coming. And a sync indicator, already a known limitation
below, is worth more once actions resolve instantly with undo instead of behind
a confirmation dialog.

Finally, measure rather than assert. `buildScheduleRows` and
`statePresentation` are pure functions in `lib/`, so a test in `scripts/` can
assert a cell budget for a realistic household the same way the existing suites
assert behaviour. A budget that is checked is a budget; a budget in a document
is a wish.

Two notes for whoever picks this up. The state map is the load-bearing change —
the day list, the grid, the grid legend and the History pills all get their
appearance from it, so doing it first makes the rest small, and doing it last
means doing it four times. And `app/page.tsx` is 3,185 lines holding all three
tabs plus every handler; none of the above requires splitting it, but the sticky
date header and the state map both touch every view inside it, which is the
natural moment to lift the tabs into their own components.

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
- The tasks tab's person filter is still a hand-rolled single-select chip strip
  that scrolls sideways, while the task filter beside it and the person filter
  on the history tab both use `MultiSelectFilter`. `personFilterOptions` is
  already built and already carries avatars. Converting it means
  `ScheduleFilters.personId` becomes `personIds: string[]`, followed by the two
  checks in `buildScheduleCell`, the `'all'` arguments in `dropTargets` and
  `missedOccurrences`, `canRearrangeWeek`, and three cases in
  `scripts/schedule-view.test.ts`. Hold the state as `string[] | null` so
  `null` can keep meaning "untouched, default to my tasks" — `currentUserId` is
  not known on first render, which is why the `'my_tasks'` sentinel exists.
- Service worker does not prompt a reload when a new version activates.
- Unused dependencies: `@google/genai`, `@hookform/resolvers`,
  `class-variance-authority`.
- `sharp` is missing, so the icon generation script cannot run.
- Dead code: `hooks/use-mobile.ts`, `lib/utils.ts`.
- `.env.example` documents variables no code reads.
