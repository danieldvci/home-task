/**
 * Fills the local Firestore emulator with a believable household.
 *
 *   npm run emulators        # terminal 1
 *   npm run dev:emulators    # terminal 2, then sign in once at localhost:3000
 *   npm run seed             # terminal 3
 *
 * Sign in first: the Auth emulator mints a fresh uid for every account, so the
 * seed reads whoever exists and makes the first of them the household owner.
 * Without that the app would load a household it is not a member of and show
 * an empty screen.
 */
import { initializeTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const PROJECT_ID = firebaseConfig.projectId;
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const HOUSEHOLD = 'hdemoseed01';

const COLORS = ['bg-[#A1C181]', 'bg-[#E5989B]', 'bg-[#3D5A80]', 'bg-[#B99543]', 'bg-[#81B29A]'];

type EmulatorAccount = { localId: string; displayName?: string; email?: string };

const fs = (context: RulesTestContext) => context.firestore() as unknown as Firestore;

const startOfDay = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
};

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const at = (offsetDays: number, hour: number) => {
  const d = startOfDay(offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function listAccounts(): Promise<EmulatorAccount[]> {
  // The emulator answers the Admin SDK's listUsers endpoint, and "owner" is the
  // bearer token it accepts in place of real credentials.
  const url = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=100`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
  } catch {
    throw new Error(`No Auth emulator on ${AUTH_EMULATOR}. Start it with: npm run emulators`);
  }
  if (!response.ok) throw new Error(`Auth emulator returned ${response.status} for ${url}`);
  const body = (await response.json()) as { users?: EmulatorAccount[] };
  return body.users ?? [];
}

async function main() {
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    console.error(
      [
        'The Auth emulator has no accounts yet, so there is nobody to own the household.',
        '',
        '  1. npm run dev:emulators',
        '  2. open http://localhost:3000 and sign in (the emulator popup accepts any address)',
        '  3. run npm run seed again'
      ].join('\n')
    );
    process.exit(1);
  }

  const [ownerAccount, ...otherAccounts] = accounts;
  const ownerUid = ownerAccount.localId;
  const memberUids = accounts.map((a) => a.localId);
  const ownerName = ownerAccount.displayName || ownerAccount.email?.split('@')[0] || 'בעל/ת הבית';

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8080 }
  });

  await testEnv.clearFirestore();

  const locals = [
    { id: 'useed_noa', name: 'נועה' },
    { id: 'useed_yael', name: 'יעל' },
    { id: 'useed_amit', name: 'עמית' }
  ];
  // One resident is away for a couple of days so the skip-the-absent path has
  // something to act on without anybody editing a profile first.
  const away = {
    absentFrom: startOfDay(0).toISOString(),
    absentUntil: startOfDay(2).toISOString()
  };

  const rotation = [ownerUid, ...locals.map((l) => l.id)];
  const yesterday = dayKey(startOfDay(-1));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = fs(context);
    const write = (path: string[], data: Record<string, unknown>) =>
      setDoc(doc(db, ['households', HOUSEHOLD, ...path].join('/')), data);

    await setDoc(doc(db, 'households', HOUSEHOLD), {
      ownerId: ownerUid,
      members: memberUids,
      name: 'בית לדוגמה'
    });

    await write(['users', ownerUid], {
      name: ownerName,
      color: COLORS[0],
      isAbsent: false,
      linkedAuth: true
    });
    await Promise.all(
      otherAccounts.map((account, i) =>
        write(['users', account.localId], {
          name: account.displayName || account.email?.split('@')[0] || `דייר ${i + 2}`,
          color: COLORS[(i + 1) % COLORS.length],
          isAbsent: false,
          linkedAuth: true
        })
      )
    );
    await Promise.all(
      locals.map((local, i) =>
        write(['users', local.id], {
          name: local.name,
          color: COLORS[(i + 1) % COLORS.length],
          isAbsent: false,
          linkedAuth: false,
          ...(local.id === 'useed_amit' ? { ...away, isAbsent: true } : {})
        })
      )
    );

    await write(['chores', 'cseed_dishes'], {
      name: 'כלים',
      category: 'מטבח',
      frequency: 'daily',
      rotation,
      currentIndex: 1,
      lastCompletedAt: at(-1, 20),
      lastCompletedLogId: 'lseed_dishes',
      anchorDate: startOfDay(-14).toISOString(),
      completions: {
        [yesterday]: { userId: ownerUid, logId: 'lseed_dishes', at: at(-1, 20) }
      }
    });

    await write(['chores', 'cseed_floor'], {
      name: 'שטיפת רצפה',
      category: 'סלון',
      frequency: 'weekly',
      rotation: [locals[0].id, locals[1].id],
      currentIndex: 0,
      lastCompletedAt: null,
      // Anchored to today so the weekly chore is visible straight away.
      anchorDate: startOfDay(0).toISOString(),
      completions: {}
    });

    await write(['chores', 'cseed_trash'], {
      name: 'הוצאת זבל',
      category: 'חוץ',
      frequency: 'custom_days',
      customDays: [0, 2, 4],
      rotation,
      currentIndex: 0,
      lastCompletedAt: null,
      anchorDate: startOfDay(-14).toISOString(),
      completions: {}
    });

    await write(['chores', 'cseed_once'], {
      name: 'כלים – סיבוב ערב',
      category: 'מטבח',
      frequency: 'once',
      onceDate: startOfDay(0).toISOString(),
      anchorDate: startOfDay(0).toISOString(),
      rotation: [locals[0].id],
      currentIndex: 0,
      lastCompletedAt: null
    });

    await write(['logs', 'lseed_dishes'], {
      userId: ownerUid,
      actorUid: ownerUid,
      action: 'ביצוע משימה',
      details: 'ביצע/ה את "כלים"',
      timestamp: at(-1, 20),
      choreId: 'cseed_dishes',
      reactions: { [ownerUid]: 'like' },
      comments: [
        {
          userId: locals[0].id,
          actorUid: ownerUid,
          text: 'תודה!',
          timestamp: at(-1, 21)
        }
      ]
    });

    await write(['logs', 'lseed_trash'], {
      userId: locals[1].id,
      actorUid: ownerUid,
      action: 'ביצוע משימה',
      details: 'ביצע/ה את "הוצאת זבל"',
      timestamp: at(-2, 18),
      choreId: 'cseed_trash'
    });

    await write(['logs', 'lseed_manual'], {
      userId: locals[0].id,
      actorUid: ownerUid,
      action: 'רישום ידני',
      details: 'ניקיתי את המקרר',
      timestamp: at(-2, 12)
    });

    await write(['logs', 'lseed_created'], {
      userId: ownerUid,
      actorUid: ownerUid,
      action: 'יצירת משימה',
      details: 'יצר/ה משימה חדשה: "שטיפת רצפה"',
      timestamp: at(-14, 9)
    });
  });

  await testEnv.cleanup();

  console.log(`Seeded household ${HOUSEHOLD} ("בית לדוגמה")`);
  console.log(`  owner:     ${ownerName} (${ownerUid})`);
  console.log(`  residents: ${locals.map((l) => l.name).join(', ')} + ${memberUids.length} signed-in`);
  console.log('  chores:    כלים (daily), שטיפת רצפה (weekly), הוצאת זבל (Sun/Tue/Thu), כלים – סיבוב ערב (today only)');
  console.log('\nReload the app to see it.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
