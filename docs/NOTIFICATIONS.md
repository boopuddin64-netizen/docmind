# Notifications & Web Push

## How alerts work
| Situation | Mechanism |
|---|---|
| App open (or reopened) | In-page scheduler (`src/lib/alertScheduler.ts`): fires a heads-up (default 60 min before) and a "due" alert exactly once per event (persisted in `localStorage.docmind_fired_alerts_v1`), catches alerts missed while closed (up to 6 h late), collapses bursts into one summary. |
| App fully closed | **Web Push**: the server stores a minimal copy of your reminders (id, title, absolute due time, lead time, snooze end) and a cron-triggered dispatcher sends a push; `public/sw.js` shows it. |
| Permission denied / no Notification API | In-app popup + toast fallback. |

Pushes use `tag = reminderId`, and the SW records each shown event, so the page never re-shows an alert Web Push already delivered.

## Endpoints
- `GET  /api/push/public-key`
- `POST /api/push/subscribe` `{subscription}` → `{subscriptionId, token}` (token = per-subscription bearer secret; only its SHA-256 is stored)
- `POST /api/push/sync-reminders` (Bearer token) `{subscriptionId, tzOffsetMinutes, reminders:[{id,title,dueAt,leadMinutes,snoozedUntil}]}` (max 500, deduped by id)
- `POST /api/push/unsubscribe` (Bearer token)
- `GET|POST /api/dispatch-alerts` — **requires `Authorization: Bearer $CRON_SECRET`**; sends due pushes, claims each event atomically (Redis `SET NX`) so overlapping runs never duplicate, prunes 404/410 subscriptions.

## Privacy
Reminder **titles are stored on the server** (Upstash Redis) so the push can say what is due. Set `PUSH_HIDE_TITLES=1` to send a generic "You have a reminder due" and keep titles out of push payloads (they are still synced). Notes/document text are never sent.

## Deploy on Vercel
1. `npm run generate-vapid` → copy the keys.
2. Vercel → Storage/Marketplace → add **Upstash Redis** (free tier) to the project; it injects `UPSTASH_REDIS_REST_URL`/`_TOKEN` (or `KV_REST_API_URL`/`_TOKEN`, also accepted).
3. Project → Settings → Environment Variables (Production): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:you@example.com`), `CRON_SECRET` (`openssl rand -hex 32`), `GEMINI_API_KEY`, plus the Upstash vars.
4. Framework preset **Vite** (Build `vite build`, Output `dist`; `vercel.json` already says so).
5. Deploy, then create the every-minute timer below.

### Every-minute timer (cron-job.org, free)
Vercel Hobby cron runs at most once per day (`vercel.json` keeps a daily 07:00 UTC backup call). For minute-level alerts:
1. Sign up at https://cron-job.org → **Create cronjob**.
2. **URL**: `https://<your-app>.vercel.app/api/dispatch-alerts`
3. **Execution schedule**: *Every 1 minute*.
4. **Advanced → Request method**: `POST` (GET also works).
5. **Advanced → Headers**: name `Authorization`, value `Bearer <your CRON_SECRET>` (the word `Bearer`, a space, then the secret).
6. Save, then *Test run*: expect HTTP 200 and JSON like `{"success":true,"sent":0,...}`. 401 = wrong/missing secret; 503 = VAPID keys not set.
(On Vercel Pro you may instead set the `crons` schedule in `vercel.json` to `* * * * *`; Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.)

## Local development
`npm run dev` runs the same API plus an in-process 30 s dispatcher; storage is `.data/push-store.json` (override with `PUSH_STORE_PATH`) unless Upstash vars are set.
