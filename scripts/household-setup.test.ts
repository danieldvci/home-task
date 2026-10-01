import assert from 'node:assert/strict';
import {
  STARTER_TEMPLATES,
  SETUP_MAX_RESIDENTS,
  buildSetupPlan,
  normalizeResidentNames,
  setupDraftProblems
} from '../lib/household-setup';
import type { SetupDraft } from '../lib/household-setup';
import { CHORE_ICON_IDS, USER_ICON_IDS, choreIconId, userIconId } from '../lib/default-icons';
import { normalizeDay } from '../lib/rotation';

// --- the starter pack itself -------------------------------------------------

assert.ok(
  STARTER_TEMPLATES.some(t => t.suggested),
  'a wizard that opens with nothing ticked asks the same question the empty app did'
);
assert.equal(
  new Set(STARTER_TEMPLATES.map(t => t.id)).size,
  STARTER_TEMPLATES.length,
  'two templates sharing an id would write one chore document over the other'
);
for (const template of STARTER_TEMPLATES) {
  assert.ok(
    (CHORE_ICON_IDS as readonly string[]).includes(template.icon),
    `starter "${template.id}" names an icon nothing can draw`
  );
  assert.equal(
    template.frequency === 'custom_days',
    (template.customDays?.length ?? 0) > 0,
    `starter "${template.id}" must carry weekdays exactly when it repeats on chosen days`
  );
}

// --- names as people actually type them --------------------------------------

assert.deepEqual(
  normalizeResidentNames('דנה, יוסי\nנועה,'),
  ['דנה', 'יוסי', 'נועה'],
  'a trailing comma must not become a resident with no name'
);
assert.deepEqual(
  normalizeResidentNames('דנה,  דנה '),
  ['דנה'],
  'the same name typed twice is one person, not a rotation that lands on them twice'
);
assert.equal(
  normalizeResidentNames(Array.from({ length: 30 }, (_, i) => `p${i}`).join(',')).length,
  SETUP_MAX_RESIDENTS,
  'a pasted address book must stop at the resident ceiling rather than half-write it'
);

// --- what the wizard refuses to commit ---------------------------------------

const owner = 'owner-uid';
const draft = (over: Partial<SetupDraft> = {}): SetupDraft => ({
  residents: [{ id: 'r1', name: 'דנה' }],
  chores: [
    { id: 'c1', name: 'שטיפת כלים', frequency: 'daily', category: 'מטבח', icon: 'dishes', rotation: [owner, 'r1'] }
  ],
  ...over
});

assert.deepEqual(setupDraftProblems(draft(), [owner]), [], 'the ordinary first run must be committable');

assert.deepEqual(
  setupDraftProblems(draft(), []),
  ['למשימה "שטיפת כלים" יש משתתף שאינו קיים'],
  'a rotation naming nobody real is a chore that can never come round'
);

assert.ok(
  setupDraftProblems(
    draft({ chores: [{ id: 'c1', name: 'כביסה', frequency: 'daily', icon: 'laundry', rotation: [] }] }),
    [owner]
  ).length > 0,
  'a chore with an empty rotation has no one to do it'
);

assert.ok(
  setupDraftProblems(draft({ residents: [{ id: 'r1', name: '   ' }] }), [owner]).some(p => p.includes('שם')),
  'a resident with a blank name would show as an empty chip forever'
);

assert.ok(
  setupDraftProblems(
    draft({
      chores: [
        { id: 'c1', name: 'כביסה', frequency: 'custom_days', customDays: [], icon: 'laundry', rotation: ['r1'] }
      ]
    }),
    [owner]
  ).some(p => p.includes('ימים')),
  'chosen-days with no day chosen never occurs'
);

// --- the documents that get written ------------------------------------------

const today = new Date('2026-09-28T17:40:00.000Z');
const plan = buildSetupPlan(
  {
    residents: [
      { id: 'r1', name: '  דנה  ' },
      { id: 'r2', name: 'יוסי', icon: 'rocket' }
    ],
    chores: [
      { id: 'c1', name: ' שטיפת כלים ', frequency: 'daily', category: 'מטבח', icon: 'dishes', rotation: [owner, 'r1'] },
      { id: 'c2', name: 'כביסה', frequency: 'custom_days', customDays: [3, 0], icon: 'laundry', rotation: ['r2'] },
      { id: 'c3', name: 'שטיפת רצפות', frequency: 'weekly', icon: 'sweep', rotation: ['r1'] }
    ]
  },
  today,
  [owner]
);

assert.equal(plan.users.length, 2, 'the owner already has a profile and must not be written a second time');
assert.equal(plan.users[0].data.name, 'דנה', 'a name is stored trimmed or it sorts and matches oddly');
assert.equal(plan.users[0].data.linkedAuth, false, 'starter residents are people who never sign in');
assert.ok(
  (USER_ICON_IDS as readonly string[]).includes(plan.users[0].data.icon),
  'an unchosen resident icon must still resolve to one that exists'
);
assert.equal(plan.users[1].data.icon, 'rocket', 'a chosen resident icon must survive the plan');

const [dishes, laundry, floors] = plan.chores;
assert.equal(dishes.data.name, 'שטיפת כלים');
assert.equal(dishes.data.currentIndex, 0, 'a new chore starts with the first person on the rotation');
assert.equal(dishes.data.anchorDate, dishes.data.startDate, 'a chore created today repeats from today');
assert.equal(
  dishes.data.startDate,
  normalizeDay(today).toISOString(),
  'the schedule must be anchored to the local day the household was set up, not to whenever it is read'
);
assert.deepEqual(laundry.data.customDays, [0, 3], 'weekdays are stored in order so the week grid reads them straight');
assert.ok(!('customDays' in floors.data), 'firestore.rules counts keys exactly, so an unused optional must be absent');
assert.ok(!('category' in floors.data), 'an empty category is a key the rules will reject');
assert.equal(
  choreIconId({ name: floors.data.name, icon: floors.data.icon }),
  'sweep',
  'the stored icon must be the one the card draws'
);

assert.throws(
  () => buildSetupPlan({ residents: [], chores: [{ id: 'c1', name: 'x', frequency: 'daily', icon: 'task', rotation: ['ghost'] }] }, today),
  /not valid/,
  'an invalid draft must not reach the batch: half a household is worse than none'
);

// --- icons resolve without anything stored -----------------------------------

assert.equal(choreIconId({ name: 'הוצאת הזבל' }), 'trash', 'a chore written before icons existed still gets a face');
assert.equal(choreIconId({ name: 'משהו אחר' }), 'task', 'an unrecognised name falls back rather than blanking');
assert.equal(
  choreIconId({ name: 'הוצאת הזבל', icon: 'not-an-icon' }),
  'trash',
  'a name written by a later build must not draw nothing here'
);
assert.equal(
  userIconId({ id: 'u1' }),
  userIconId({ id: 'u1' }),
  'a resident must not change face between reloads'
);

console.log('household-setup tests passed');
