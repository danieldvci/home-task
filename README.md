# Happy Home Tasks (תורנויות הבית)

Simple household task app — daily and weekly chore sharing without the arguments.

Built with **Next.js**, **Firebase**, and **Tailwind CSS**.

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

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run production build |
| `npm run lint` | ESLint |

## Roadmap

Deferred features, the market comparison behind them, and the limitations kept
on purpose are in [ROADMAP.md](ROADMAP.md).

## Deploy

This is a Next.js app. Typical hosts: **Vercel** or **Netlify** (Next runtime). Point Firebase Auth authorized domains at your production URL.
