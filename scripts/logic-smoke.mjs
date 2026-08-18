/**
 * Smoke tests for chore rotation / day projection logic
 * (extracted from app/page.tsx helpers for offline verification)
 */

function getActiveAssigneeIndex(chore, users, startIndex) {
  if (!chore.rotation || chore.rotation.length === 0) return -1;
  for (let i = 0; i < chore.rotation.length; i++) {
    const checkIndex = (startIndex + i) % chore.rotation.length;
    const userId = chore.rotation[checkIndex];
    const user = users.find(u => u.id === userId);
    if (user && !user.isAbsent) return checkIndex;
  }
  return startIndex;
}

function getOccurrencesBetween(chore, startDate, endDate) {
  let occurrences = 0;
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (start.getTime() === end.getTime()) return 0;

  const direction = start < end ? 1 : -1;
  let current = new Date(start);
  const isNotDone = () => direction === 1 ? current.getTime() < end.getTime() : current.getTime() > end.getTime();
  let loopCount = 0;

  while (isNotDone() && loopCount < 1000) {
    loopCount++;
    current.setDate(current.getDate() + direction);
    current.setHours(0, 0, 0, 0);

    let occurs = false;
    if (chore.frequency === 'daily') {
      occurs = true;
    } else if (chore.frequency === 'custom_days') {
      if (chore.customDays?.includes(current.getDay())) occurs = true;
    } else if (chore.frequency === 'weekly') {
      const diff = Math.abs(current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (Math.round(diff) % 7 === 0) occurs = true;
    }
    if (occurs) occurrences += direction;
  }
  return occurrences;
}

function getProjectedAssigneeIndex(chore, users, startIndex, occurrences) {
  if (!chore.rotation || chore.rotation.length === 0) return -1;
  let currentIdx = getActiveAssigneeIndex(chore, users, startIndex);
  if (occurrences === 0) return currentIdx;

  const dir = occurrences >= 0 ? 1 : -1;
  let steps = Math.abs(occurrences);

  while (steps > 0) {
    for (let i = 1; i <= chore.rotation.length; i++) {
      let checkIndex = (currentIdx + (dir * i)) % chore.rotation.length;
      if (checkIndex < 0) checkIndex += chore.rotation.length;
      const userId = chore.rotation[checkIndex];
      const user = users.find(u => u.id === userId);
      if (user && !user.isAbsent) {
        currentIdx = checkIndex;
        steps--;
        break;
      }
    }
  }
  return currentIdx;
}

const users = [
  { id: 'u1', name: 'A', isAbsent: false },
  { id: 'u2', name: 'B', isAbsent: true },
  { id: 'u3', name: 'C', isAbsent: false },
];

let passed = 0;
let failed = 0;
function assert(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// 1. Skip absent users in rotation
{
  const chore = { rotation: ['u1', 'u2', 'u3'], frequency: 'daily' };
  assert('skips absent assignee', getActiveAssigneeIndex(chore, users, 1) === 2, `got ${getActiveAssigneeIndex(chore, users, 1)}`);
}

// 2. Empty rotation
{
  const chore = { rotation: [], frequency: 'daily' };
  assert('empty rotation returns -1', getActiveAssigneeIndex(chore, users, 0) === -1);
}

// 3. Missing user id in rotation is skipped (treated like absent)
{
  const chore = { rotation: ['missing', 'u3'], frequency: 'daily' };
  assert('missing profile skipped', getActiveAssigneeIndex(chore, users, 0) === 1);
}

// 4. Daily: tomorrow advances one occurrence
{
  const today = new Date('2026-08-18T12:00:00');
  const tomorrow = new Date('2026-08-19T12:00:00');
  const chore = { rotation: ['u1', 'u3'], frequency: 'daily', currentIndex: 0 };
  const occ = getOccurrencesBetween(chore, today, tomorrow);
  assert('daily +1 day = 1 occurrence', occ === 1, `got ${occ}`);
  const idx = getProjectedAssigneeIndex(chore, users, 0, occ);
  assert('daily +1 day advances to next person', idx === 1, `got ${idx}`);
}

// 5. Same day = 0 occurrences
{
  const today = new Date('2026-08-18T12:00:00');
  const chore = { rotation: ['u1', 'u3'], frequency: 'daily' };
  assert('same day = 0 occurrences', getOccurrencesBetween(chore, today, today) === 0);
}

// 6. custom_days only counts matching weekdays
{
  // Aug 18 2026 is Tuesday (2). customDays [4]=Thursday
  const tue = new Date('2026-08-18T12:00:00');
  const thu = new Date('2026-08-20T12:00:00');
  const chore = { rotation: ['u1', 'u3'], frequency: 'custom_days', customDays: [4] };
  const occ = getOccurrencesBetween(chore, tue, thu);
  assert('custom_days Tue->Thu counts Thu', occ === 1, `got ${occ}`);
}

// 7. Admin identity bug simulation: Firebase ownerId !== local profile id
{
  const householdOwnerId = 'Sehf7wscgFXdh68nU3ZEBjPR2Ht1'; // Firebase UID
  const currentUserId = 'u1786967347205'; // local profile
  const isAdmin = householdOwnerId === currentUserId;
  assert('KNOWN BUG: isAdmin never true (UID vs profile id)', isAdmin === false);
}

console.log('\n---');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
