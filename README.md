# Happy Home Tasks (תורנויות הבית)

Simple household task app — daily and weekly chore sharing without the arguments.

Built with **Next.js**, **Firebase**, and **Tailwind CSS**.

What the app does and why it is built this way is in
[HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies:

```bash
npm install
```

2. Firebase is configured for project **`daniel-home-chore`** (`firebase-applet-config.json`).

   In [Firebase Console](https://console.firebase.google.com/project/daniel-home-chore):
   - Enable **Authentication → Google**
   - Create **Firestore** (default database)
   - Deploy rules: `npx firebase deploy --only firestore:rules`
   - Ensure `localhost` is under Auth → Authorized domains

3. Optional: copy env for Gemini (only if you add AI features):

```bash
cp .env.example .env.local
```

4. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Run against local emulators

Everything below talks to the Firebase Emulator Suite on your machine — no real
accounts, no real database, nothing to clean up afterwards.

**Prerequisites:** a JDK 21 or newer on `PATH` (the Firestore and Storage
emulators are Java processes). Check with `java -version`.

```bash
npm run emulators       # terminal 1: auth, firestore, storage + UI on :4000
npm run dev:emulators   # terminal 2: the app, pointed at the emulators
```

Open [http://localhost:3000](http://localhost:3000) and sign in. The emulator's
Google popup accepts any address you make up and issues a throwaway account.

Then give yourself a household worth looking at:

```bash
npm run seed
```

The seed makes the first emulator account the household owner and adds three
local residents, four chores across every schedule type, and a few days of
history. It clears the emulator's data first, so it is safe to re-run. Emulator
data disappears when you stop the emulators.

## Tests

```bash
npm test            # everything
npm run test:unit   # rotation and household helpers, no emulator needed
npm run test:rules  # security rules, starts and stops its own emulator
```

`test:rules` exercises `firestore.rules` and `storage.rules` directly: who may
read a household, that a log or comment cannot be attributed to an account
other than the caller, that skip and swap stay with the owner while any member
may mark a chore done, and that a proof photo cannot be overwritten once it
exists. It needs ports 8080 and 9199 free, so stop `npm run emulators` first.

One caveat on the storage half: the Storage emulator cannot resolve the
`firestore.get` membership lookups in `storage.rules`, so the test file
replaces those two helpers with fixed answers and covers everything else with
the real rule text. Membership is covered by the Firestore cases instead.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run dev:emulators` | Development server against local emulators |
| `npm run emulators` | Firebase Emulator Suite (auth, firestore, storage) |
| `npm run seed` | Fill the emulator with a demo household |
| `npm test` | Unit tests and security-rules tests |
| `npm run build` | Production build |
| `npm start` | Run production build |
| `npm run lint` | ESLint |

## Roadmap

Deferred features, the market comparison behind them, and the limitations kept
on purpose are in [ROADMAP.md](ROADMAP.md).

## Deploy

This is a Next.js app. Typical hosts: **Vercel** or **Netlify** (Next runtime). Point Firebase Auth authorized domains at your production URL.
