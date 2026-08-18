import assert from 'node:assert/strict';
import {
  householdDisplayName,
  mergeAuthPhoto,
  pickActiveHouseholdId,
  profileStorageKey,
  activeHouseholdStorageKey,
  generateHouseholdId
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

const id = generateHouseholdId();
assert.match(id, /^h[a-z0-9]{10}$/);
assert.notEqual(generateHouseholdId(), generateHouseholdId());

console.log('household-utils tests passed');
