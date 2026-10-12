# Study Buddy 📚

A cozy pixel-art study timer. Press one button to start studying, and your little
study buddy works at their desk while the world outside the window moves through
day and night, seasons and weather. Every hour you study earns coins to decorate
their room.

Runs in any modern browser and installs as an app on iPhone, iPad and Mac
(Safari → Share → **Add to Home Screen** / **Add to Dock**). Works offline.

## How it works

| Real world | In the room |
| --- | --- |
| 1 hour studied | 1 sim day (30 min daytime + 30 min night) |
| 10 hours studied | 1 season (spring → summer → autumn → winter) |
| 40 hours studied | 1 sim year (fireworks on new year's night) |

The sim clock only moves while you're studying.

- **Coins:** 100 per hour, credited per minute.
- **Streaks:** a day counts once you study ≥ 30 minutes. Each streak day adds
  +10% to your coin multiplier, up to ×2.
- **Still studying?** After an hour without interaction you're asked to
  confirm. If you don't answer within 5 minutes the session pauses and the
  unconfirmed time isn't counted.
- **Pomodoro mode:** 25 min focus / 5 min break, with a 15 min break after every
  4th (configurable). Breaks don't count as study time. On breaks your buddy
  plays the PS5, lounges on the beanbag or stands at the standing desk (if you own them).

### A little living world

- **Make it yours:** name your buddy and pick their look (skin tone, 10 hairstyles,
  hair colour, top). Pick wallpaper, flooring and curtains, and the **view from
  the window**: quiet street, seaside, city skyline, countryside or forest cabin.
  Or start from a preset room. Change any of it for free with the ✏️ button.
- **Every view is alive:** seasons, weather (rain on the glass, storms, snow,
  fog, frost), day/night, and random happenings: hot-air balloons, kites,
  rainbows after rain, aurora, dolphins and whales, trains, deer and foxes,
  fireflies, fireworks, UFOs…
- **Catch things:** tap shooting stars, birds on the windowsill, balloons and
  UFOs for bonus coins.
- **Tap anything:** your buddy waves, turns around and chats. Pets purr and wag,
  and the mug, plant, clock and lamp all react. Speech bubbles react to the weather,
  the season, your streak and what happens outside. You can turn them off in Settings.
- **Daily letter:** a letter slips under the door each day with a kind note
  from someone in the buddy's world (and a few coins).
- **The plant grows** as your total study hours grow, and the windowsill
  decorations change with the seasons.
- **Zen mode** (⛶ or `F`): the room fills the screen with a minimal timer.

### Things that keep you going

- **Daily quests** (3 a day) and **weekly quests**, plus 26 achievements.
- **Shop:** computer upgrades, attire, pets (cat, dog, fish, lizard, hamster,
  parrot, robot vacuum…) and furniture.
- **Limited-time items** follow the real calendar (Halloween, harvest, winter
  festival, Lunar New Year, Valentine's, spring, summer, back to school). Once
  you buy one, you keep it.
- **Subjects & journal:** tag what you studied at the end of a session and
  see your time by subject in Stats.
- **Friends & leaderboards** (optional, needs cloud sync): share a friend code,
  compete on weekly hours, and visit each other's rooms.
- **Share your room:** a share card image plus a link that lets anyone visit
  your room (read-only).
- **Sound:** procedurally generated lo-fi music, typing, and ambience that
  matches the view (waves and gulls, city hum and trains, sheep and a rooster,
  pines and owls). Each has its own switch in Settings.

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

Leaderboards use the same project: the `leaderboard` table is created by
`supabase/schema.sql` too. If you set up sync before leaderboards existed, run
the file again; it's safe to re-run. Each player chooses whether to appear on
boards in the **Friends** tab.

Sync is local-first. Everything works offline and merges automatically
when you're back online. Sessions and purchases are merged as logs, so nothing
gets double-counted.
