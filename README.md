# Study Buddy 📚

A cozy pixel-art study timer. Press one button to start studying; a little
character works at his desk while the world outside his window moves through
day and night, seasons and weather. Every hour you study earns coins to upgrade
his room.

Runs in any modern browser and installs as an app on iPhone, iPad and Mac
(Safari → Share → **Add to Home Screen** / **Add to Dock**). Works offline.

## How it works

| Real world | In the room |
| --- | --- |
| 1 hour studied | 1 sim day (30 min daytime + 30 min night) |
| 10 hours studied | 1 season (spring → summer → autumn → winter) |
| 40 hours studied | 1 sim year |

The sim clock only moves while you're studying.

- **Coins:** 100 per hour, credited per minute.
- **Streaks:** a day counts once you study ≥ 30 minutes. Each streak day adds
  +10% to your coin multiplier, up to ×2.
- **Still studying?** After an hour without interaction you're asked to
  confirm. If you don't answer within 5 minutes the session pauses and the
  unconfirmed time isn't counted.
- **Pomodoro mode:** 25 min focus / 5 min break, with a 15 min break after every
  4th (configurable). Breaks don't count as study time.
- **Shop:** computer upgrades, attire, pets (with behaviours) and furniture.
- **Achievements** give bonus coins (and one exclusive item).
- **Weather:** clear, cloudy, rain, storms, snow and fog, plus moon phases,
  passing cars and pedestrians, and the odd shooting star.
- **Sound:** procedurally generated lo-fi music, rain, typing and ambient
  sounds (no audio files).

## Development

```bash
npm install
npm run dev        # app at http://localhost:5173, room lab at /lab.html
npm test           # unit tests
npm run build      # production build in dist/
```

Code layout:

- `src/core` — pure, tested logic: sessions, pomodoro, economy, streaks, shop,
  achievements, sim clock, weather, sync merge.
- `src/render` — the pixel-art room renderer.
- `src/audio` — the Web Audio engine.
- `src/state` — local storage.
- `src/sync` — Supabase cloud sync.
- `src/ui` — the interface.

## Deploying to GitHub Pages

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge to `main` (or run the *Test and deploy* workflow manually). The site
   appears at `https://<user>.github.io/study-buddy/`.

## Cloud sync (Supabase, free tier)

Sync keeps your hours, coins and room identical on all devices.

1. Create a free project at <https://supabase.com>.
2. In the project, open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql)
   and run it.
3. **Authentication → Providers → Email**: keep it enabled. Optionally turn off
   "Confirm email" so new accounts work immediately.
4. **Authentication → URL Configuration**: set Site URL to your GitHub Pages URL.
5. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
   The anon key is designed to be public; row-level security keeps each user's
   data private.
6. Give those to the app, in either of two ways:
   - Easiest: open **Settings → Cloud sync** in the app on each device and paste them.
   - Or, to build them into the site: in GitHub, open **Settings → Secrets and
     variables → Actions → Variables** and add `SUPABASE_URL` and
     `SUPABASE_ANON_KEY`, then redeploy.
7. Create an account in **Settings → Cloud sync** on one device and sign in with
   the same account on the others.

Sync is local-first. Everything works offline and merges automatically
when you're back online. Sessions and purchases are merged as logs, so nothing
gets double-counted.
