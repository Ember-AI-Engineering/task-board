# Claude Code Prompt: Integrate @emberai-engg/task-board

## Context

We've published a reusable Kanban task board package `@emberai-engg/task-board` on npm (public, no auth needed). It provides a fully functional task board with drag-and-drop, @mentions, notifications, filtering, infinite scroll, and more. We need to integrate it into this application.

The package exports a `<TaskBoardProvider>` that accepts the app's API client and user info, and a `<TaskBoard>` component that renders the full board UI.

The backend reference implementation (Python FastAPI + MongoDB) is in the same repo at `github.com/Ember-AI-Formerly-Snapdev/task-board` under the `backend-reference/` folder.

---

## Preflight — run these checks BEFORE starting

- Verify the Node version supports the app's Next.js / React version
- Verify the Python version for the backend (or equivalent runtime)
- **Check `DATABASE_URL` in the app's `.env`. If it points to production, switch to a local/dev database first.** The integration will create 6 new tables and seed a project — you do NOT want that happening against production until you're ready to deploy.
- If auth is frontend-only, note the credentials needed to log in after starting servers
- If the repo has existing running dev servers, kill them before starting new ones

---

## Step 1: Install the package

```bash
npm install @emberai-engg/task-board
```

No `.npmrc` or registry config needed — it's a public package on npmjs.org.

Verify `node_modules/@emberai-engg/task-board/dist/` contains `index.js`, `index.mjs`, `index.d.ts`, and `styles.css`.

## Step 2: Set up the backend task board endpoints

The package's frontend expects 16 REST API endpoints plus a projects endpoint. Identify the backend framework and database used in this app and proceed accordingly.

### 2a: Get the backend reference

Clone or fetch the reference implementation from `https://github.com/Ember-AI-Formerly-Snapdev/task-board`. The backend code is in the `backend-reference/` folder. It contains:

- `api/taskboard.py` — 16 REST endpoints
- `models/taskboard.py` — Data models and constants
- `dependencies/tenant.py` — Auth/tenant dependency (must be adapted to this app's auth)
- `scripts/seed_projects.py` — Seed script for initial projects

Read `backend-reference/README.md` for full details on each file and what needs adapting.

### 2b: Copy and adapt

Copy the backend reference files into the equivalent locations in this app's backend. Adapt:

- Import paths to match this app's module structure
- Auth/tenant dependency to match this app's existing auth approach
- Database connection to match this app's existing DB setup

**Auth adaptation:** The reference uses JWT-based auth with `get_current_user()` returning a user dict. Adapt this to match however this app authenticates:
- **JWT auth:** Reuse the reference as-is, adjusting the token decode function
- **Session/cookie auth:** Read the user from the session or cookie instead of a JWT
- **No auth / frontend-only auth:** Use a hardcoded user dict or read from a config. The user dict must include: `username`, `name`, `email`, `role`, `apps` (list of project slugs or `["all"]`), `is_internal` (bool), `is_reviewer` (bool)

**Database adaptation:** The reference uses **MongoDB + Motor**. Most apps fall into one of three buckets:

- **MongoDB** — use the reference as-is, only adjust import paths
- **PostgreSQL / MySQL** (SQLAlchemy, SQLModel, Django ORM, Prisma) — rewrite the 6 collections as tables. Use auto-increment IDs or UUIDs. Replace Motor's `insert_one`/`find`/`update_one`/`delete_one` with your ORM's equivalents. Create indexes matching those in `backend-reference/README.md`.
- **Firestore / DynamoDB** — map collections 1:1. See `backend-reference/README.md` for partition/sort key recommendations.

Regardless of database, the API request/response contracts must stay the same. Only the storage layer changes.

**ORM model registration:** If the app uses SQLAlchemy/SQLModel with `SQLModel.metadata.create_all()` (or Django migrations, or Prisma), the new taskboard models MUST be imported somewhere that runs at startup — typically the same file as other model imports. Otherwise the metadata won't include them and the tables won't be created.

**CRITICAL — ID format:** All IDs returned to the frontend MUST be **strings**. If using integer primary keys, convert them: `"id": str(row.id)`. The frontend passes IDs as strings in all API calls.

**PostgreSQL timezone warning:** The reference uses `datetime.now(timezone.utc)` (timezone-aware). PostgreSQL with `TIMESTAMP WITHOUT TIME ZONE` columns (the SQLAlchemy/SQLModel default) will throw `"can't subtract offset-naive and offset-aware datetimes"` from asyncpg. Use `datetime.utcnow()` (naive) or change the column type to `TIMESTAMP WITH TIME ZONE`.

**Field serialization pitfalls (from real bugs):**
- `tags`: must be an **array** on the wire. If stored as comma-separated text in DB, split it on read: `[t.strip() for t in row.tags.split(",") if t.strip()]`.
- `description`: must be an **object** on the wire with 5 fields: `problem`, `user_story`, `proposed_behavior`, `acceptance_criteria`, `open_questions`. If stored as a JSON string, `json.loads()` it on read. Legacy plain-string values must be normalized to `{problem: <string>, user_story: "", ...}`.
- `comment_count` / `internal_comment_count`: increment/decrement on every comment add/delete. Forgetting this makes the card footer counts drift.

The key frontend contract:
- `GET /tasks` returns `{ [status]: { tasks: [...], total: N, unread: N } }`
- `GET /tasks/{id}` returns the task with `comments` and `activity` arrays
- All IDs are strings
- All dates are ISO 8601 strings

### 2c: Add a projects endpoint

Add a `GET /api/v1/taskboard/projects` endpoint that returns the list of projects the current user has access to:

```json
[
  { "slug": "my-project", "name": "My Project", "description": "..." }
]
```

Filter by the user's `apps` list (return all if `apps` contains `"all"`).

**Frontend note:** As of v0.3.2, the package auto-fetches from this endpoint. You do NOT need to pass a `projects` prop to `<TaskBoardProvider>` — just ensure the backend exposes `/projects`.

### 2d: Register the task board router

Register the router at the `/api/v1/taskboard` prefix in the main app file.

### 2e: Set up the database and seed

Create the 6 tables/collections: `taskboard_tasks`, `taskboard_comments`, `taskboard_activity`, `taskboard_user_reads`, `taskboard_notifications`, `taskboard_projects`. See `backend-reference/README.md` for the full schema and indexes.

- Relational (Postgres/MySQL): create a migration
- Document (MongoDB/Firestore): collections auto-create on first write

**Seed the initial project:** Either run the seed script or wire it into the app's startup so the project is auto-created if it doesn't exist. Name the project based on what this app does. The seed must be idempotent (skip if the project already exists).

### 2f: Verify the backend BEFORE touching the frontend

**Do NOT skip this step.** Most "frontend bugs" in past integrations turned out to be backend shape mismatches. Run these curl tests first:

```bash
# 1. Projects endpoint returns an array of {slug, name, description}
curl http://localhost:PORT/api/v1/taskboard/projects

# 2. Create a task — verify id is a STRING, tags is an ARRAY, description is an OBJECT
curl -X POST http://localhost:PORT/api/v1/taskboard/tasks \
  -H "Content-Type: application/json" \
  -d '{"project_slug":"<your-slug>","title":"test","priority":"medium","status":"backlog","tags":["bug-fix"]}'

# 3. List tasks — verify grouped response shape
curl "http://localhost:PORT/api/v1/taskboard/tasks?project_slug=<your-slug>&per_column=10"
# Expected: {backlog: {tasks: [...], total: 0, unread: 0}, queued: {...}, in_progress: {...}, ...}
```

**Stop and fix if:**
- IDs come back as numbers (must be strings — wrap with `str()`)
- `tags` comes back as a string (must be an array — split it)
- `description` comes back as a string (must be an object — `json.loads()` it)
- Response for `/tasks` is a flat array instead of the grouped `{status: {tasks, total, unread}}` shape

## Step 3: Integrate the frontend

### 3a: Create the API client wrapper

The package expects an `ApiClient` interface with `get`, `post`, `patch`, and `delete` methods that return `{ data: T }`. If this app uses Axios, pass it directly. If this app uses `fetch`, create a thin wrapper:

```typescript
const apiClient = {
  get: async <T>(url: string) => {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    return { data: data as T };
  },
  post: async <T>(url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    return { data: data as T };
  },
  patch: async <T>(url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    return { data: data as T };
  },
  delete: async <T>(url: string) => {
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    return { data: data as T };
  },
};
```

Ensure auth headers (cookies, tokens) are included. Use `credentials: 'include'` for cookie auth.

### 3b: Import the CSS and configure Tailwind

Import `@emberai-engg/task-board/styles.css` in the app's global CSS or root layout.

**Critical for Tailwind v4:** Tailwind v4 skips `node_modules` by default, so the package's 300+ Tailwind utility classes won't be compiled.

- **Tailwind v4** (uses `@tailwindcss/postcss`, no `tailwind.config` file): Add a `@source` directive in the app's global CSS: `@source "../node_modules/@emberai-engg/task-board/dist";`
- **Tailwind v3** (has `tailwind.config.js`/`tailwind.config.ts`): Add `"./node_modules/@emberai-engg/task-board/dist/**/*.{js,mjs}"` to the `content` array in the Tailwind config.

Without this, the board renders but styles are broken.

**Font:** The package does NOT bundle a font — it inherits from the app's CSS. The board will render in whatever font family the consuming app already uses (which is preferred). Just ensure the app has a base `font-family` on `body` with `-webkit-font-smoothing: antialiased` for clean rendering.

### 3c: Create the task board page

> ### ⚠️ STOP — Read this first. It's caused every integration to fail at least once.
>
> `<TaskBoard>` uses `h-full` and `min-w-max` internally. If its parent container can grow with content (most flex/block containers can), the 8 columns will push the container wider and **horizontal scroll will never trigger**.
>
> The ONLY reliable pattern is **absolute positioning inside a fixed-height relative container**:
>
> ```tsx
> <div className="relative" style={{ height: 'calc(100vh - HEADER_HEIGHT_PX)' }}>
>   <div className="absolute inset-0 p-6 lg:p-10">
>     <TaskBoardProvider ...>
>       <TaskBoard />
>     </TaskBoardProvider>
>   </div>
> </div>
> ```
>
> Replace `HEADER_HEIGHT_PX` with the app's actual header height (e.g., `64px`).
>
> **Do not try `h-full`, `flex-1`, `h-screen`, or `min-h-0` chains.** They won't work in every layout. Use the absolute-positioning pattern above.

Create a new page at `/task-board` using the pattern above. The provider and board should:

- Pass the API client wrapper (with auth headers already configured)
- Pass the current logged-in user's info (see **User object** below)
- Set up feature flags (drag-and-drop, comments, filters enabled; attachments disabled for now)
- Pass an `onError` callback for error visibility
- Optionally pass `onShareFeedback` callback to enable the Share Feedback button in the header

**Scrollbar conflicts:** If the app uses a global `no-scrollbar` CSS class that hides scrollbars, add this override in global CSS to restore the board's horizontal scrollbar:

```css
.eb-tb-board-scroll {
  overflow-x: scroll !important;
  scrollbar-width: thin !important;
}
.eb-tb-board-scroll::-webkit-scrollbar {
  display: block !important;
  height: 10px !important;
}
```

**User object:** The `user` prop on `<TaskBoardProvider>` MUST include ALL of these fields. Missing fields will cause runtime errors in TaskDetailPanel:

```typescript
{
  username: string;      // Required — used for comment ownership checks
  name: string;          // Required — display name
  email: string;         // Required — shown in mentions
  apps: string[];        // Required — project access list, or ["all"]
  role?: string;         // Optional — "user", "org_admin", etc.
  is_reviewer?: boolean; // Optional — defaults to false
  is_internal?: boolean; // Optional — controls internal comments visibility
}
```

The package ships with built-in `CreateTaskModal` and `TaskDetailPanel`, so no render props are needed for a complete UI. Just render `<TaskBoard />` inside the provider and it works out of the box. Render props (`renderCreateTask`, `renderTaskDetail`) are available as overrides only if the defaults don't fit.

### 3d: Add navigation link

Add a "Task Board" link to the app's sidebar or navigation.

- **If the sidebar uses React components:** import `KanbanIcon` from the package and render `<KanbanIcon size={20} />`.
- **If the sidebar uses non-React icon systems** (iconify `<iconify-icon>`, raw SVG strings, or an `{icon: 'some-name'}` config pattern): special-case the task board item to render `<KanbanIcon />` as JSX rather than trying to force it into the existing string pattern.

Match the existing nav's active-state and hover styling.

## Step 4: Verify the integration

Start both backend and frontend dev servers, navigate to `/task-board`, and verify:

- Board renders with the seeded project (project selector auto-populates from `/projects`)
- Columns display correctly
- Creating a task works end to end
- Dragging tasks between columns works (no duplicate cards — requires v0.3.4+)
- Task detail panel opens on click
- Comments can be added
- @mentions show user suggestions
- Notification bell works
- Tag filters work
- Loading skeletons appear during fetches
- Errors surface via the onError callback

## Important notes

- The package does NOT handle authentication. The API client must already include auth headers.
- The package uses Tailwind utility classes and relies on the consuming app's Tailwind setup.
- If the backend endpoints are at a different prefix than `/api/v1/taskboard`, pass the correct `apiBasePath` prop to `<TaskBoardProvider>`.
- Do NOT modify the package code in `node_modules`. If something doesn't work, we fix it in the package repo and publish a new version.
- Do NOT reference any local folders or paths outside this project. Everything comes from the npm package or the GitHub repo.
