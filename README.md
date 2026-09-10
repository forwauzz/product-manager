# ALIE Product Manager

A product management tool for the ALIE team: deployment-order roadmap, features grouped into spaces, parallel and timeline views, and a Research & Development pipeline for items that students research before they are scoped.

The same front end runs in two places:

| Where | Server | Storage | Access |
| --- | --- | --- | --- |
| Locally | Express (`server/server.js`) | `data/db.json` | Open on `localhost` |
| Cloudflare | Worker (`worker/index.js`) | D1 database | Passcode (`APP_PASSCODE` secret) |

Both use the same API implementation in `shared/core.js`.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:4177. Data is saved to `data/db.json` on every change. Sample data is created on first run; use the gear menu in the bottom-left to reset it, export a JSON backup, or import one.

```bash
npm test
```

runs the core and API test suites.

## The app

- **Product Roadmap**: features in the order they ship, with Order, Timeline and Gantt modes at weekly, monthly or quarterly grain. Drag rows or cards to reorder or reschedule; change owner and month inline.
- **Features**: one card per space, plus the full list. Drag a feature onto a space in the left nav to tag it.
- **Parallel view**: one column per space, side by side.
- **Timeline**: columns by period.
- **Research & Development**: everything tagged R&D. Group by stage (Backlog, Assigned, In progress, Findings, Concluded), by student, or by space. Each item carries a research question and findings, and can be assigned to a student. A feature gets there by:
  - the "Push to R&D" button on its page or the R&D field in its preview drawer,
  - setting its state to Research,
  - dragging it onto Research & Development in the left nav,
  - or creating it directly on the board with "New research item".
- **Market / ICP**: ideal client profiles, one per customer segment (seeded from the September 2026 segmentation research: the four regimes CNESST, SAAQ, IVAC and Civil, plus the top-scored buyer segments). Each profile carries a description, TAM / SAM / SOM and notes. Tag features to profiles in the overlap matrix (or drag cards in the By profile view) to see which features are core (every profile asks for them), shared, or independent (one profile only). Click a profile card to focus on what it asks for; the same profile filter is available on the roadmap and the features list.
- **Projects**: the switcher at the top of the nav creates, renames and deletes projects (ALIE, Teche Health, GEO-Pulse...). Each has its own roadmap and research.
- **Search**: the box top-right or Ctrl/Cmd+K searches every project.
- Every change saves automatically. If the same document was changed from another device in the meantime, the two copies are merged and saved again.

## Deploy to Cloudflare

Prerequisites: a Cloudflare account and `npx wrangler login` done once.

```bash
# 1. Create the database and paste its id into wrangler.jsonc (database_id)
npm run cf:db:create

# 2. Create the table
npm run cf:db:migrate

# 3. Set the passcode that gates the app (you will be prompted for it)
npm run cf:secret

# 4. Deploy
npm run deploy
```

The worker serves `public/` as static assets and answers `/api/*` from D1. Without `APP_PASSCODE` the app is open to anyone who has the URL, so set it. Rotate it with `npm run cf:secret` at any time; existing sessions are signed with the passcode and become invalid.

`npm run cf:dev` runs the worker locally against a local D1 (run `npm run cf:db:migrate:local` first).

## API

All endpoints are under `/api` and speak JSON.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/state` | Whole document `{ version, state }` |
| PUT | `/state` | Replace the document. Send `{ version, state }`; a stale `version` gets `409` with the current copy |
| GET/POST | `/projects`, `/spaces`, `/people`, `/students` | List or add |
| GET/POST | `/icps` | List or create ideal client profiles (`name`, `kind`, `description`, `tam`, `sam`, `som`, `notes`) |
| PATCH/DELETE | `/icps/:id` | Edit or delete a profile (features lose the tag) |
| PATCH/DELETE | `/projects/:id` | Rename or delete (features go with it) |
| DELETE | `/spaces/:name`, `/people/:name`, `/students/:name` | Remove and clean up references |
| GET/POST | `/features` | List (filters: `project`, `space`, `rnd=true`) or create |
| GET/PATCH/DELETE | `/features/:id` | Read, edit or delete one feature |
| GET | `/export` | Download a backup |
| POST | `/import` | Replace everything with a backup |
| POST | `/reset` | Back to the sample data |
| GET | `/session` | `{ authed, required }` |
| POST | `/login`, `/logout` | Passcode session (Cloudflare only) |

## Layout

```
public/           the app (index.html, app.js, styles.css, login.html)
shared/core.js    data model, seed, normalisation, API handler
server/           local Express server and JSON-file store
worker/           Cloudflare Worker, D1 store and schema
test/             node:test suites
alie-product.html the original prototype, kept for reference
```
