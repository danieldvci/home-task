# Happy Home Tasks (תורנויות הבית)

Simple household task app — daily and weekly chore sharing without the arguments.

Built with **Next.js**, **Firebase**, and **Tailwind CSS**.

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies:

```bash
npm install
```

2. Copy env example and fill in secrets:

```bash
cp .env.example .env.local
```

Set `GEMINI_API_KEY` (and `APP_URL` if needed). Review `firebase-applet-config.json` for your Firebase project.

3. Start the app:

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

## Deploy

This is a Next.js app. Typical hosts: **Vercel** or **Netlify** (Next runtime). Point Firebase Auth authorized domains at your production URL.
