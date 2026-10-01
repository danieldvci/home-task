import assert from 'node:assert/strict';
import {
  householdDisplayName,
  householdNeedsSetup,
  isHouseholdManager,
  isHouseholdOwner,
  mergeAuthPhoto,
  pickActiveHouseholdId,
  profileColor,
  profileStorageKey,
  activeHouseholdStorageKey,
  generateHouseholdId,
  PROFILE_COLORS
} from '../lib/household-utils';

assert.equal(householdDisplayName({ id: 'habc', name: 'בית משפחתי' }), 'בית משפחתי');
assert.equal(householdDisplayName({ id: 'habc', name: '  ' }), 'habc');
assert.equal(householdDisplayName({ id: 'habc' }), 'habc');

const homes = [
  { id: 'h1', ownerId: 'u', members: ['u'] },
  { id: 'h2', ownerId: 'u', members: ['u'], name: 'B' }
];
assert.equal(pickActiveHouseholdId(homes, 'h2'), 'h2');
assert.equal(pickActiveHouseholdId(homes, 'missing'), 'h1');
assert.equal(pickActiveHouseholdId([], 'h1'), null);

assert.equal(profileStorageKey('h1', 'uid'), 'chores_user_h1_uid');
assert.equal(activeHouseholdStorageKey('uid'), 'chores_active_household_uid');

assert.deepEqual(mergeAuthPhoto({}, 'https://lh3.googleusercontent.com/a/x'), {
  photoURL: 'https://lh3.googleusercontent.com/a/x'
});
assert.equal(
  mergeAuthPhoto({ photoURL: 'https://lh3.googleusercontent.com/a/x' }, 'https://lh3.googleusercontent.com/a/x'),
  null
);
assert.equal(mergeAuthPhoto({ photoURL: 'old' }, null), null);
// Custom upload must not be replaced by Google photo on reload
assert.equal(
  mergeAuthPhoto(
    { photoURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/avatars%2Fu.jpg?alt=media' },
    'https://lh3.googleusercontent.com/a/x'
  ),
  null
);

// Who may manage the home
const home = { id: 'h1', ownerId: 'owner', members: ['owner', 'co', 'plain'], managerIds: ['co'] };
assert.equal(isHouseholdOwner(home, 'owner'), true);
assert.equal(isHouseholdOwner(home, 'co'), false, 'a co-manager must not be able to hand out roles');
assert.equal(isHouseholdManager(home, 'owner'), true, 'the owner manages without being listed as a manager');
assert.equal(isHouseholdManager(home, 'co'), true);
assert.equal(isHouseholdManager(home, 'plain'), false);
assert.equal(isHouseholdManager(home, undefined), false, 'a signed-out reader manages nothing');
assert.equal(
  isHouseholdManager({ id: 'h2', ownerId: 'owner', members: ['owner'] }, 'owner'),
  true,
  'a home saved before managers existed must keep working for its owner'
);

// The setup wizard runs once, for homes that have never run it
assert.equal(
  householdNeedsSetup({ id: 'h1', ownerId: 'o', members: ['o'], setupComplete: false }),
  true
);
assert.equal(
  householdNeedsSetup({ id: 'h1', ownerId: 'o', members: ['o'] }),
  false,
  'a household that predates the wizard already has its chores: it must never be sent through setup'
);
assert.equal(householdNeedsSetup(null), false, 'nothing loaded yet is not a household to set up');

// A face is drawn from the id, so it is the same on every device
assert.equal(profileColor('u1'), profileColor('u1'));
assert.ok(PROFILE_COLORS.includes(profileColor('anything-at-all')));

const id = generateHouseholdId();
assert.match(id, /^h[a-z0-9]{10}$/);
assert.notEqual(generateHouseholdId(), generateHouseholdId());

console.log('household-utils tests passed');
