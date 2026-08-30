# Couple Space · Shared Notes

A small, private, shared notebook for two partners inside the **Couple Space** ecosystem.

The current step delivers the **database, secure API, authorization layer, mobile-first Notes dashboard, and the note editor**. Autosave / draft recovery are explicitly deferred.

## Tech stack

- [Next.js](https://nextjs.org) 15 (App Router) + React 19
- TypeScript (strict)
- Tailwind CSS v4
- PostgreSQL (Neon-compatible) + Drizzle ORM
- Zod for runtime validation
- Vitest for tests

No realtime, CRDT, WebSockets, or heavy UI frameworks are used.

## Requirements

- Node.js **>= 20.18**
- pnpm **11.x** (declared in `packageManager`)
- A PostgreSQL database (Neon, local, etc.)

## Install

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local and set DATABASE_URL
pnpm db:migrate
```

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `DEV_AUTH_USER_ID` | Dev only | UUID of the test user. The server rejects it in production. |
| `DEV_AUTH_SPACE_ID` | Dev only | UUID of the test Couple Space. The server rejects it in production. |

**Never** commit `.env.local`.

## Database

Schema is generated with Drizzle Kit. Two PostgreSQL schemas are created:

- `notes` — owns the `notes` table only.
- `notes_dev_identity` — **dev/test stub** for `users`, `couple_spaces`, and `memberships`. These mirror the shape of the tables that the central `couple-space` application will own in production. They exist only so this repository can run in isolation during development. They are not a long-term identity system and will be removed once central SSO is wired in.

Migration commands:

```bash
pnpm db:generate   # regenerate SQL from schema.ts (only when schema changes)
pnpm db:migrate    # apply pending migrations to DATABASE_URL
```

The migration is idempotent (`CREATE … IF NOT EXISTS`), so re-running is safe.

## Run locally

```bash
pnpm dev
```

Open <http://localhost:3000>. The Notes dashboard lives at `/notes`.

## Typecheck, lint, build

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Tests

```bash
pnpm test
```

The test suite runs against the same `DATABASE_URL` defined in `.env.local` and uses a dedicated test schema setup. The first run will create the `notes` and `notes_dev_identity` schemas if they don't exist; each run drops and re-applies them.

Coverage:

- **DB CRUD** — create / read / update / soft-delete / archive, plus archived & deleted notes excluded from active list
- **Authorization** — cross-space GET / PATCH / DELETE all return 404, client-supplied `spaceId` cannot bypass membership, 401 when unauthenticated, 403 when authenticated but not a member
- **Concurrency** — revision increments correctly, stale revision is rejected, stale update cannot overwrite newer content
- **Validation** — bad title / category / color / document / revision / extra fields are rejected
- **Dashboard helpers** — note preview extraction (including malformed content), category / color meta, relative time, search & category filter composition, pinned-first ordering
- **Editor helpers** — `coerceNoteDocument` accepts valid TipTap docs, rejects malformed / primitive / wrong-type shapes without throwing
- **Editor save action** — persists title + content, bumps revision, returns 401 unauthenticated, 422 on malformed content, 404 on foreign note, 409 on stale revision
- **Autosave controller** — debounce, queue (in-flight + newer local), 409 conflict, 5xx retry with backoff, 401 stops retrying, draft recovery, localStorage failure safety, no secrets stored
- **Local draft storage** — deterministic key, SSR-safe, storage-quota-safe, no auth tokens / cookies / secrets

## Editor (`/notes/[id]`)

The note editor is a single Client Component (`NoteEditor`) instantiated from the `/notes/[id]` Server Component. The page enforces the Step 2 server-side authorization — the URL ID is never trusted; `getAuthorizedNote` returns 404 for foreign or missing notes.

Stack:

- **TipTap 2.10.3** (StarterKit + Underline + TaskList + TaskItem + Placeholder)
- `@tiptap/pm` as the prosemirror peer
- Editor instantiated with `immediatelyRender: false` to avoid SSR / hydration mismatch
- Canonical document is the structured JSON stored in `notes.content` — never HTML, never Markdown
- All persistence goes through server actions: `saveNoteContentAction` (title + content) and the existing `patchNoteMetaAction` (pin / category / color)

Features:

- **Title input** above the editor (200-char cap, distinct visual weight, wraps on long titles)
- **Rich text**: paragraphs, headings (H1–H3), bold, italic, underline
- **Lists**: bullet, ordered, task / checklist (TipTap TaskList + TaskItem with `nested: false`)
- **Toolbar**: sticky at the bottom of the editor, horizontally scrollable on small screens, reflects active formatting (`aria-pressed`)
- **Pin / Category / Color** chips: reuse the same meta actions as the dashboard, with optimistic updates and rollback on failure
- **Explicit Save button** in the header (truthful — the editor does **not** autosave). Save status pill: "Saved · 12s ago" / "Unsaved changes" / "Saving…" / "Couldn't save"
- **Stale-revision reconcile dialog**: if the partner saved first, the editor fetches the latest copy and offers "Use latest" or "Keep mine"
- **Loading**: `app/notes/[id]/loading.tsx` renders an editor-shaped skeleton (no full-screen spinner)
- **Not found / unauthorized**: server returns `notFound()`; the page does not leak whether a foreign note exists
- **Malformed content**: `coerceNoteDocument` safely falls back to a single empty paragraph; never crashes the page
- **Autosave (Step 5)**: every keystroke persists a local draft and, after ~1 s of inactivity, sends a PATCH with the last known server revision. See "Autosave & draft recovery" below.

## Autosave & draft recovery (Step 5)

Reliable single-user editing of a shared note. The editor autosaves silently, protects work locally between saves, and refuses to silently overwrite newer content.

State machine:

```
saved → dirty (on edit) → saving (after 1 s idle) → saved
                          ↘ offline / error / conflict / auth_error
```

- **Debounce**: `AUTOSAVE_DEBOUNCE_MS = 1000`. Continual typing restarts the timer.
- **One in-flight save at a time.** If the user edits while a save is running, the newer local state is kept and a second save is queued using the newly-confirmed revision as soon as the first one returns. The server's atomic revision check (`UPDATE … WHERE revision = ?`) prevents stale overwrites.
- **Local draft**: every `markDirty` writes `notes:draft:{noteId}` to `localStorage` with `{ title, content, baseRevision, updatedAt, version }`. The draft is the primary protection — a refresh or network outage never loses unsaved text.
- **Recovery on open**: the editor compares the server snapshot to the local draft. The draft is restored only if it represents work newer than the server revision. Stale drafts (based on a future revision) are ignored, not silently applied.
- **Network failure / 5xx**: status flips to "Offline — saved locally" / "Couldn't save — retrying". A bounded retry kicks in with delays `5 s, 10 s, 20 s, 30 s`.
- **401 / 403**: status flips to "Sign in to keep saving". No further automatic retries.
- **409 stale revision**: status "Newer version found" and a conflict dialog with "Use latest" (discard local) or "Keep mine" (retry the local draft over the server).
- **Lifecycle**: `online` triggers a controlled retry, `visibilitychange`/`pagehide` flush the current state.
- **No secrets** are stored in the draft. No IndexedDB. No realtime. No second editor state system.

### Intentionally NOT implemented in Step 5

- Cross-tab conflict resolution (BroadcastChannel / storage events)
- IndexedDB or full offline-first database
- Service worker / PWA
- keepalive `fetch` (best-effort flush on pagehide; no blocking unload handlers)
- Automatic character-level merge
- Realtime collaboration, presence, cursors

These belong to later steps.

## Dashboard (`/notes`)

The dashboard is a single Server Component page (`app/notes/page.tsx`) that loads the active notes for the authorized Couple Space and hands them to a client component (`NotesDashboard`). The page is rendered behind Next's automatic `loading.tsx` skeleton, so the UI never blocks on a giant spinner.

Features:

- **Header** — "Our notes" title, note count, and a labelled search field.
- **Category filter** — horizontal scrollable chips for `All / General / Ideas / Lists / Letters / Plans / Memories`. Only values the server schema accepts are exposed.
- **Pinned / Recent sections** — pinned notes always appear above the rest, even when filtering or searching.
- **Note cards** — title, plain-text preview, category chip, color swatch, pin toggle, relative timestamp, "by you" indicator, and a confirmable Remove action.
- **Optimistic pin / category / color** — the UI updates immediately and reverts on server error.
- **Create** — the prominent "New note" button calls a server action that calls the existing `createNote` service and then `router.push`es to `/notes/[id]`.
- **Open** — each card title is a `Link` to `/notes/[id]`.
- **States** — empty (with a friendly first-note prompt), no-search-results, no-category-results, loading skeleton, and an unauthenticated gate (`AuthRequired`).
- **No data leaks** — the dashboard never queries the database directly; it only uses the existing `listActiveNotes` service and server actions. Client never supplies `userId` or `spaceId`.

### Local development UI access (`NOTES_DEV_UI`)

The Notes app depends on a server-side authentication boundary. In production this will be the central Couple Space app. While that does not exist yet, the app can still be inspected locally by setting a single development-only flag.

Add to `.env.local`:

```bash
NOTES_DEV_UI=true
```

What it does (and does not do):

- `getAuthContext()` returns a synthetic `{ userId: "dev-ui", spaceId: "dev-ui" }` context without consulting the dev identity tables.
- `listActiveNotes("dev-ui")` returns `[]`, so `/notes` renders the **real empty state** of the dashboard.
- `getAuthorizedNote(id, "dev-ui")` returns a fresh in-memory empty `NoteDto` for any valid UUID, so `/notes/[id]` renders the **real editor component** (TipTap + toolbar + metadata + reconcile dialog). The synthetic note is never persisted and never appears in the list.
- Write paths (`createNote`, `updateNote`, `softDeleteNote`) also short-circuit for the synthetic `dev-ui` space: they mutate an in-memory `Map<noteId, NoteDto>` instead of touching the database. This lets "New note" → editor → autosave → meta PATCH → delete be exercised end-to-end without a real Couple Space. The map is process-local, never persisted, and the dashboard list still hides all dev-UI notes.
- The dev identity tables (`notes_dev_identity`) are **not** consulted and no fake data is written.

What it does **not** do:

- It does not bypass production authentication. `isDevUiMode()` is hard-coded to return `false` when `NODE_ENV === "production"`, so even an accidentally set flag on Vercel is inert.
- It does not alter the Notes API authorization for non dev-ui spaces.
- It does not accept `userId` / `spaceId` from query parameters, headers, or cookies.
- It does not create fake sessions, fake users, or fake memberships.
- It does not persist dev-UI notes across server restarts. The in-memory map is intentionally lost on process exit, so dev-UI notes never leak into the real database.

## Dev identity seeding (alternative to `NOTES_DEV_UI`)

If you want the **full** dev flow — i.e. a real Couple Space row in the dev identity tables with a matching membership — run:

```bash
pnpm db:seed:dev
```

This creates a fresh user, a fresh space, a membership row linking them, and writes the IDs into `.env.local` as `DEV_AUTH_USER_ID` / `DEV_AUTH_SPACE_ID`. Re-run any time you want a new dev identity. Notes you create will be scoped to that real Couple Space and persist between runs.

## API overview

| Method | Path | Description |
| --- | --- | --- |
| `GET`    | `/api/notes` | List active notes for the authenticated Couple Space. Pinned first, then newest updated. |
| `POST`   | `/api/notes` | Create a note. Client `spaceId` is rejected if it differs from the authorized space. |
| `GET`    | `/api/notes/:id` | Fetch a single note. Returns 404 for unauthorized / foreign notes. |
| `PATCH`  | `/api/notes/:id` | Update fields and/or `archived`. Requires `revision` for optimistic concurrency. Returns 409 on stale revision. |
| `DELETE` | `/api/notes/:id` | Soft-delete (sets `deletedAt`). |

Successful responses return `{ note }` or `{ notes: [...] }`. Errors return `{ error: { code, message, details? } }`.

## Authorization model

Every request flows through `getAuthContext()` in `src/server/auth/auth-context.ts`:

1. The server determines the authenticated user **server-side**. The client never supplies a `userId`.
2. The server verifies the user is a member of the requested Couple Space.
3. All queries are scoped to the authorized `spaceId`.

The current implementation reads a dev-only identity from environment variables. When the central `couple-space` application ships, this single function will be swapped for a real session check; no other code needs to change.

## Revision / concurrency

`PATCH /api/notes/:id` requires the client to send the `revision` it last saw. The server issues a single atomic `UPDATE … WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND revision = ?` and increments `revision` in the same statement. If zero rows are affected, the response is `409 Conflict` with `error.code = "stale_revision"` and `error.details = { currentRevision, expectedRevision }`.

## Intentionally NOT implemented yet

- Editor features beyond TipTap: slash commands, code blocks, tables, embeds, mentions, comments, attachments
- Realtime collaboration (WebSockets, SSE, CRDT/OT/Yjs/Automerge, presence, cursors)
- Full version history UI
- Cross-app SSO / OAuth / session handoff
- Service worker / PWA offline architecture
- Production auth (the dev identity stub is for local + tests only)
- Trash / restore UI for soft-deleted notes
- Cross-tab editing coordination
