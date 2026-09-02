/**
 * Security-rules tests, run against the Firestore and Storage emulators.
 *
 *   npm run test:rules
 *
 * Every case reseeds from scratch, so they can be read in any order. The
 * fixture is one household with an owner, a plain member, and an outsider who
 * belongs to nothing.
 */
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore
} from 'firebase/firestore';
import { ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';

const HOUSEHOLD = 'h1';
const OWNER = 'owner-uid';
const MEMBER = 'member-uid';
const OUTSIDER = 'outsider-uid';
const CHORE = 'chore1';
const LOG = 'log1';
const RESIDENT = 'resident1';

// The compat types the harness returns are structurally the modular ones.
const fs = (context: RulesTestContext) => context.firestore() as unknown as Firestore;
const st = (context: RulesTestContext) => context.storage() as unknown as FirebaseStorage;

const path = (...segments: string[]) => ['households', HOUSEHOLD, ...segments].join('/');

const chore = (over: Record<string, unknown> = {}) => ({
  name: 'כלים',
  frequency: 'daily',
  rotation: [RESIDENT, 'resident2'],
  currentIndex: 0,
  completions: {},
  ...over
});

const log = (over: Record<string, unknown> = {}) => ({
  userId: RESIDENT,
  actorUid: MEMBER,
  action: 'ביצע משימה',
  details: 'כלים',
  timestamp: '2026-08-24T09:00:00.000Z',
  reactions: {},
  comments: [],
  ...over
});

const comment = (over: Record<string, unknown> = {}) => ({
  userId: RESIDENT,
  actorUid: MEMBER,
  text: 'כל הכבוד',
  timestamp: '2026-08-24T10:00:00.000Z',
  ...over
});

const resident = (over: Record<string, unknown> = {}) => ({
  name: 'דניאל',
  color: 'bg-[#A1C181]',
  isAbsent: false,
  linkedAuth: false,
  ...over
});

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
const asJpeg = { contentType: 'image/jpeg' };

/**
 * The Storage emulator cannot resolve the `firestore.get` calls that
 * `storage.rules` uses to check membership: the lookup comes back null however
 * the document is seeded (firebase/firebase-js-sdk#6803). Left alone, every
 * upload would be denied and the storage cases would pass for the wrong
 * reason, so the two membership helpers are swapped for fixed answers and
 * everything else — write-once, content type, size, own-avatar — is the real
 * rule text. Membership itself is covered by the Firestore cases above.
 */
function stubCrossServiceLookups(source: string) {
  const replaced = source
    .replace(
      /function isMember\(householdId\) \{[\s\S]*?\n {4}\}/,
      `function isMember(householdId) {\n      return isSignedIn() && householdId == '${HOUSEHOLD}';\n    }`
    )
    .replace(
      /function isOwnerOfHousehold\(householdId\) \{[\s\S]*?\n {4}\}/,
      `function isOwnerOfHousehold(householdId) {\n      return isSignedIn() && request.auth.uid == '${OWNER}';\n    }`
    );
  if (replaced.includes('firestore.get')) {
    throw new Error('storage.rules changed shape: the membership helpers were not stubbed');
  }
  return replaced;
}

let testEnv: RulesTestEnvironment;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = fs(context);
    await setDoc(doc(db, 'households', HOUSEHOLD), {
      ownerId: OWNER,
      members: [OWNER, MEMBER],
      name: 'בית לדוגמה'
    });
    await setDoc(doc(db, path('users', RESIDENT)), resident());
    await setDoc(doc(db, path('users', MEMBER)), resident({ name: 'חבר', linkedAuth: true }));
    await setDoc(doc(db, path('chores', CHORE)), chore());
    await setDoc(doc(db, path('logs', LOG)), log());
  });
}

let failed = 0;
let passed = 0;
// clearStorage() leaves objects behind, which would trip the write-once rule
// with a file from an earlier case, so each case gets its own file names.
let caseId = 0;

async function test(name: string, body: () => Promise<void>) {
  caseId += 1;
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seed();
  try {
    await body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-home-task',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: {
      rules: stubCrossServiceLookups(readFileSync('storage.rules', 'utf8')),
      host: '127.0.0.1',
      port: 9199
    }
  });

  const owner = () => fs(testEnv.authenticatedContext(OWNER));
  const member = () => fs(testEnv.authenticatedContext(MEMBER));
  const outsider = () => fs(testEnv.authenticatedContext(OUTSIDER));

  console.log('\nmembership');

  await test('a member lists the chores', async () => {
    await assertSucceeds(getDocs(collection(member(), path('chores'))));
  });

  await test('an outsider cannot list the chores', async () => {
    await assertFails(getDocs(collection(outsider(), path('chores'))));
  });

  await test('an outsider cannot list the history', async () => {
    await assertFails(getDocs(collection(outsider(), path('logs'))));
  });

  await test('a signed-out visitor gets nothing', async () => {
    const anon = fs(testEnv.unauthenticatedContext());
    await assertFails(getDoc(doc(anon, 'households', HOUSEHOLD)));
  });

  await test('any signed-in user may read a household document, which is what makes joining possible', async () => {
    await assertSucceeds(getDoc(doc(outsider(), 'households', HOUSEHOLD)));
  });

  console.log('\nlogs are bound to the account that wrote them');

  await test('a member writes a log under their own account', async () => {
    await assertSucceeds(setDoc(doc(member(), path('logs', 'log2')), log()));
  });

  await test('a log cannot be attributed to another account', async () => {
    await assertFails(setDoc(doc(member(), path('logs', 'log2')), log({ actorUid: OWNER })));
  });

  await test('a log without an actor is rejected', async () => {
    const withoutActor: Record<string, unknown> = log();
    delete withoutActor.actorUid;
    await assertFails(setDoc(doc(member(), path('logs', 'log2')), withoutActor));
  });

  await test('the resident credited stays free to choose, since a phone is shared', async () => {
    await assertSucceeds(setDoc(doc(member(), path('logs', 'log2')), log({ userId: 'resident2' })));
  });

  await test('an outsider cannot write a log', async () => {
    await assertFails(setDoc(doc(outsider(), path('logs', 'log2')), log({ actorUid: OUTSIDER })));
  });

  await test('only the owner deletes history', async () => {
    await assertFails(deleteDoc(doc(member(), path('logs', LOG))));
    await assertSucceeds(deleteDoc(doc(owner(), path('logs', LOG))));
  });

  console.log('\nreactions and comments');

  await test('a member sets their own reaction', async () => {
    await assertSucceeds(updateDoc(doc(member(), path('logs', LOG)), { reactions: { [MEMBER]: 'like' } }));
  });

  await test('a member cannot react on behalf of somebody else', async () => {
    await assertFails(updateDoc(doc(member(), path('logs', LOG)), { reactions: { [OWNER]: 'like' } }));
  });

  await test('an unsupported reaction is rejected', async () => {
    await assertFails(updateDoc(doc(member(), path('logs', LOG)), { reactions: { [MEMBER]: 'rage' } }));
  });

  await test('a member appends a comment under their own account', async () => {
    await assertSucceeds(updateDoc(doc(member(), path('logs', LOG)), { comments: [comment()] }));
  });

  await test('a comment cannot be attributed to another account', async () => {
    await assertFails(
      updateDoc(doc(member(), path('logs', LOG)), { comments: [comment({ actorUid: OWNER })] })
    );
  });

  await test('an existing comment cannot be rewritten', async () => {
    const existing = comment({ text: 'המקורי' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(fs(context), path('logs', LOG)), log({ comments: [existing] }));
    });
    await assertFails(
      updateDoc(doc(member(), path('logs', LOG)), { comments: [comment({ text: 'שונה' }), comment()] })
    );
  });

  console.log('\nchores');

  await test('a member marks a chore done', async () => {
    await assertSucceeds(
      updateDoc(doc(member(), path('chores', CHORE)), {
        currentIndex: 1,
        lastCompletedAt: '2026-08-24T09:00:00.000Z',
        lastCompletedLogId: LOG,
        completions: { '2026-08-24': { userId: RESIDENT, logId: LOG, at: '2026-08-24T09:00:00.000Z' } }
      })
    );
  });

  await test('a member cannot rename a chore', async () => {
    await assertFails(updateDoc(doc(member(), path('chores', CHORE)), { name: 'שטיפת רצפה' }));
  });

  await test('a member cannot reorder the rotation, so skip and swap stay with the owner', async () => {
    await assertFails(updateDoc(doc(member(), path('chores', CHORE)), { rotation: ['resident2', RESIDENT] }));
  });

  await test('the owner reorders the rotation', async () => {
    await assertSucceeds(updateDoc(doc(owner(), path('chores', CHORE)), { rotation: ['resident2', RESIDENT] }));
  });

  await test('a member cannot create a chore', async () => {
    await assertFails(setDoc(doc(member(), path('chores', 'chore2')), chore()));
  });

  await test('a one-off task must say which day it falls on', async () => {
    await assertFails(
      setDoc(doc(owner(), path('chores', 'chore2')), chore({ frequency: 'once' }))
    );
    await assertSucceeds(
      setDoc(doc(owner(), path('chores', 'chore3')), chore({ frequency: 'once', onceDate: '2026-08-24' }))
    );
  });

  await test('an unknown field on a chore is rejected', async () => {
    await assertFails(setDoc(doc(owner(), path('chores', 'chore2')), chore({ notes: 'לא קיים' })));
  });

  await test('moving and swapping days need no rule change, because entries are opaque', async () => {
    // Rules cannot iterate map values, so `completions` is validated only as a
    // map. That is what lets a relocation ship without touching the key-count
    // check every other chore field has to be added to.
    await assertSucceeds(
      updateDoc(doc(owner(), path('chores', CHORE)), {
        completions: {
          '2026-08-24': { userId: RESIDENT, at: '2026-08-24T09:00:00.000Z', movedTo: '2026-08-26', pending: true },
          '2026-08-26': {
            userId: RESIDENT,
            at: '2026-08-24T09:00:00.000Z',
            movedFrom: '2026-08-24',
            assignedTo: RESIDENT,
            pending: true
          }
        }
      })
    );
  });

  await test('a member can rearrange days, which rules cannot restrict to the owner', async () => {
    // Documented trade-off: `completions` is on the non-owner allowlist because
    // marking done lives there too, so the admin gate is client-side only.
    await assertSucceeds(
      updateDoc(doc(member(), path('chores', CHORE)), {
        completions: {
          '2026-08-25': { userId: RESIDENT, at: '2026-08-25T09:00:00.000Z', assignedTo: 'resident2', swappedWith: '2026-08-27', pending: true }
        }
      })
    );
  });

  await test('a chore may record the day it starts from', async () => {
    await assertSucceeds(
      setDoc(doc(owner(), path('chores', 'chore4')), chore({ startDate: '2026-08-24T00:00:00.000Z' }))
    );
    await assertFails(
      setDoc(doc(owner(), path('chores', 'chore5')), chore({ startDate: 7 }))
    );
  });

  console.log('\nhousehold membership changes');

  await test('a newcomer adds only themselves', async () => {
    await assertSucceeds(
      updateDoc(doc(outsider(), 'households', HOUSEHOLD), { members: [OWNER, MEMBER, OUTSIDER] })
    );
  });

  await test('a newcomer cannot drag somebody else in', async () => {
    await assertFails(
      updateDoc(doc(outsider(), 'households', HOUSEHOLD), { members: [OWNER, MEMBER, OUTSIDER, 'friend'] })
    );
  });

  await test('a member leaves on their own', async () => {
    await assertSucceeds(updateDoc(doc(member(), 'households', HOUSEHOLD), { members: [OWNER] }));
  });

  await test('a member cannot remove anybody else', async () => {
    await assertFails(updateDoc(doc(member(), 'households', HOUSEHOLD), { members: [MEMBER] }));
  });

  await test('the owner disconnects a member', async () => {
    await assertSucceeds(updateDoc(doc(owner(), 'households', HOUSEHOLD), { members: [OWNER] }));
  });

  await test('only the owner renames the household', async () => {
    await assertFails(updateDoc(doc(member(), 'households', HOUSEHOLD), { name: 'בית חדש' }));
    await assertSucceeds(updateDoc(doc(owner(), 'households', HOUSEHOLD), { name: 'בית חדש' }));
  });

  console.log('\nresident profiles');

  await test('the owner adds a resident', async () => {
    await assertSucceeds(setDoc(doc(owner(), path('users', 'resident2')), resident({ name: 'נועה' })));
  });

  await test('a member cannot add a resident for somebody else', async () => {
    await assertFails(setDoc(doc(member(), path('users', 'resident2')), resident({ name: 'נועה' })));
  });

  await test('a member creates their own linked profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(fs(context), path('users', MEMBER)));
    });
    await assertSucceeds(setDoc(doc(member(), path('users', MEMBER)), resident({ linkedAuth: true })));
  });

  await test('a member marks themselves away', async () => {
    await assertSucceeds(
      updateDoc(doc(member(), path('users', MEMBER)), {
        isAbsent: true,
        absentFrom: '2026-08-24T00:00:00.000Z',
        absentUntil: '2026-08-26T00:00:00.000Z'
      })
    );
  });

  await test('a member cannot edit another resident', async () => {
    await assertFails(updateDoc(doc(member(), path('users', RESIDENT)), { isAbsent: true }));
  });

  console.log('\nfiles (membership stubbed, see above)');

  const proof = (context: RulesTestContext, index = 0) =>
    ref(st(context), `households/${HOUSEHOLD}/proofs/log${caseId}_${index}.jpg`);
  // Mirrors uploadUserAvatar: the extension is part of the file name the rule
  // matches on, so a test path without it would not exercise the real rule.
  const avatar = (context: RulesTestContext, userId: string) =>
    ref(st(context), `households/${HOUSEHOLD}/avatars/${userId}.jpg`);

  await test('a member uploads a proof photo', async () => {
    await assertSucceeds(uploadBytes(proof(testEnv.authenticatedContext(MEMBER)), jpeg, asJpeg));
  });

  await test('a proof photo cannot be replaced once it exists', async () => {
    const context = testEnv.authenticatedContext(MEMBER);
    await assertSucceeds(uploadBytes(proof(context), jpeg, asJpeg));
    await assertFails(uploadBytes(proof(context), jpeg, asJpeg));
  });

  await test('a second photo for the same completion is a separate file', async () => {
    const context = testEnv.authenticatedContext(MEMBER);
    await assertSucceeds(uploadBytes(proof(context, 0), jpeg, asJpeg));
    await assertSucceeds(uploadBytes(proof(context, 1), jpeg, asJpeg));
  });

  await test('a proof photo must be a jpeg', async () => {
    await assertFails(
      uploadBytes(proof(testEnv.authenticatedContext(MEMBER)), jpeg, { contentType: 'application/pdf' })
    );
  });

  await test('a proof photo over 3 MB is rejected', async () => {
    const tooBig = new Uint8Array(3 * 1024 * 1024 + 1);
    await assertFails(uploadBytes(proof(testEnv.authenticatedContext(MEMBER)), tooBig, asJpeg));
  });

  await test('a member sets their own avatar', async () => {
    const context = testEnv.authenticatedContext(MEMBER);
    await assertSucceeds(uploadBytes(avatar(context, MEMBER), jpeg, asJpeg));
  });

  await test('a member cannot set somebody else\'s avatar', async () => {
    const context = testEnv.authenticatedContext(MEMBER);
    await assertFails(uploadBytes(avatar(context, RESIDENT), jpeg, asJpeg));
  });

  await test('the owner sets an avatar for a local resident', async () => {
    const context = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(uploadBytes(avatar(context, RESIDENT), jpeg, asJpeg));
  });

  await test('an avatar may be replaced, unlike a proof photo', async () => {
    const context = testEnv.authenticatedContext(MEMBER);
    await assertSucceeds(uploadBytes(avatar(context, MEMBER), jpeg, asJpeg));
    await assertSucceeds(uploadBytes(avatar(context, MEMBER), jpeg, asJpeg));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
