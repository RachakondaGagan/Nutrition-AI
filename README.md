# NutritionX AI - Personal Project

AI-assisted nutrition journal. **This download contains the backend and a front-end prototype. It does not yet contain the React client wired to the API.** See "What is and isn't here".

## What is and isn't here

| Included | Status |
|---|---|
| `server/` Express + TypeScript REST API (food entries, water, saved foods, daily summary, history, text and image analysis) | Written, **not yet run** |
| Grok service (xAI Responses API, structured output, Zod re-validation, timeout, one retry, typed errors) | Written, **not yet run against live xAI** |
| Mock AI provider (used automatically when no `XAI_*` keys are set) | Written, not yet run |
| Deterministic calculator (totals, portion scaling, unknown handling, calorie/macro sanity check) | Written, not yet run |
| Vitest tests (calculator, schemas, API incl. ownership, idempotency, untracked days) | Written, **not yet run** |
| `supabase/migrations/0001_init.sql` (tables, indexes, RLS) | Written, not yet run |
| `client-prototype/index.html` | Standalone UI demo. Open it in a browser. It is **not connected** to the server |

Not built yet: React/Vite client wired to the API, Supabase data layer (the server stores to a local JSON file for now; the migration is ready for when it is swapped in), onboarding, settings, saved-meal logging UI, Playwright end-to-end tests, data export, account deletion.

## Quick start (no accounts or keys needed)

Requires Node 20+.

```bash
npm run install:all     # installs server dependencies
npm test                # run unit and API tests
npm run dev             # API on http://localhost:4000, mock AI, local JSON storage
```

Then try:

```bash
curl -X POST localhost:4000/api/nutrition/analyze-text \
  -H "Content-Type: application/json" \
  -d '{"description":"2 boiled eggs and 2 slices of brown bread"}'
```

Run `npm run typecheck` as well. This code was written without being able to install packages, so expect to fix a few small type errors on the first run.

## Enable Grok

1. Copy `.env.example` to `.env` in the repo root.
2. Set `XAI_API_KEY` (from console.x.ai), `XAI_TEXT_MODEL` and `XAI_VISION_MODEL`. The example uses `grok-4.7`, which xAI's docs list as current and image-capable. Verify against https://docs.x.ai/developers/models.
3. Restart. The startup log should say `AI provider : grok`.

xAI documents JPEG and PNG for image input, so the image endpoint accepts only those. A client must convert WebP to JPEG first.

## Enable Supabase auth

1. Create a project and run `supabase/migrations/0001_init.sql` in the SQL editor.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`. The API then requires `Authorization: Bearer <access token>` and verifies it with Supabase on every request.
3. The server does not use the service-role key. Keep it out of this repo.

Until the Supabase data layer replaces `src/store.ts`, authenticated users are still stored in the local JSON file, separated by user id.

## API

All routes except `/api/health` require auth. Send `X-Timezone: Asia/Kolkata` (any IANA name) so dates use the user's local day.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | |
| POST | `/api/nutrition/analyze-text` | `{description, meal_type?}`. Returns an estimate; saves nothing |
| POST | `/api/nutrition/analyze-image` | Raw `image/jpeg` or `image/png` body, max 8 MB |
| POST/GET | `/api/food-entries` | GET needs `?date=YYYY-MM-DD`. POST accepts `client_request_id` for safe retries |
| PATCH/DELETE | `/api/food-entries/:id` | Quantity-only PATCH scales known nutrients proportionally |
| GET | `/api/nutrition/daily-summary?date=` | Recomputed from saved entries |
| GET | `/api/nutrition/history?from=&to=` | Days with no entries return `tracked:false`, not zeros |
| GET/POST | `/api/saved-foods` | |
| GET/POST | `/api/water`, PATCH/DELETE `/api/water/:id` | |

Errors always look like `{ "error": { "code", "message", "details?" } }`.

## Design decisions

- The model identifies foods and estimates; **the server sums totals**. The model's reply has no totals field.
- Unknown nutrient values are `null` end to end and counted in `unknown_items`, never silently zero.
- `needs_confirmation` is always true. Nothing is saved until the client posts to `/api/food-entries`.
- AI endpoints are rate-limited (10/min per IP by default). Photos are processed in memory and not stored.

## Security notes

Never commit `.env`. Only `VITE_`-prefixed variables belong in a browser bundle, and none of the server variables should ever have that prefix. Logs contain error messages and schema paths only, never keys or request bodies.

## Known limitations

Calories and macros from an LLM are estimates. Portion sizes from photos are rough, and hidden oil, sugar and sauces are guesses. Targets are guides, not medical advice; people with relevant conditions should consult a qualified professional.
