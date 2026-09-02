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

_(none yet)_
