# Claude Code Prompt: Integrate @emberai-engg/task-board

## Context

We've published a reusable Kanban task board package `@emberai-engg/task-board` on npm (public, no auth needed). It provides a fully functional task board with drag-and-drop, @mentions, notifications, filtering, infinite scroll, and more. We need to integrate it into this application.

The package exports a `<TaskBoardProvider>` that accepts the app's API client and user info, and a `<TaskBoard>` component that renders the full board UI.

The backend reference implementation (Python FastAPI) is in the same repo at `github.com/Ember-AI-Formerly-Snapdev/task-board` under the `backend-reference/` folder.

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

**Database adaptation:** The reference implementation uses **MongoDB** (via Motor async driver). If this app uses a different database, you MUST rewrite the data access layer to match. The API request/response contracts must stay the same — only the storage layer changes. Here's how to adapt for common databases:

- **PostgreSQL / MySQL (SQLAlchemy):** Replace MongoDB collection calls with SQLAlchemy ORM models and queries. Create tables for `taskboard_tasks`, `taskboard_comments`, `taskboard_activity`, `taskboard_user_reads`, `taskboard_notifications`, and `taskboard_projects`. Use auto-incrementing IDs or UUIDs instead of ObjectId. Replace `insert_one` → `session.add()`, `find` → `session.query()`, `update_one` → `session.execute(update(...))`, `delete_one` → `session.delete()`.
- **PostgreSQL (asyncpg / raw SQL):** Write async queries directly. The collection names map to table names. Create appropriate indexes matching those listed in `backend-reference/README.md`.
- **DynamoDB:** Use partition keys (e.g., `project_slug#status` for tasks) and sort keys (`position`). Notifications need a GSI on `recipient + read + created_at`.
- **Firestore:** Map collections 1:1. Use subcollections for comments under tasks if preferred. Replace ObjectId with Firestore auto-IDs.
- **Prisma ORM:** Define models in `schema.prisma` matching the 6 collections, then use the Prisma client in the route handlers.

**CRITICAL — ID format:** Regardless of database, all IDs returned to the frontend MUST be **strings**. If using integer primary keys, convert them: `"id": str(row.id)`. The frontend passes IDs as strings in all API calls.

**PostgreSQL timezone warning:** The reference backend uses `datetime.now(timezone.utc)` (timezone-aware). PostgreSQL with `TIMESTAMP WITHOUT TIME ZONE` columns (the SQLAlchemy/SQLModel default) will throw `"can't subtract offset-naive and offset-aware datetimes"` from asyncpg. Use `datetime.utcnow()` (naive) instead, or change your column type to `TIMESTAMP WITH TIME ZONE`.

The key contract the frontend expects:
- `GET /tasks` returns `{ [status]: { tasks: [...], total: N, unread: N } }`
- `GET /tasks/{id}` returns the task with `comments` and `activity` arrays
- All IDs are strings
- All dates are ISO 8601 strings
- The `_serialize_doc` pattern (converting DB-native IDs to string `id` fields) must be replicated in whatever ORM/driver you use

### 2c: Add a projects endpoint

The reference implementation does not include a projects list endpoint, but the frontend needs one to populate the project selector. Add a `GET /api/v1/taskboard/projects` endpoint that returns the list of projects the current user has access to:

```json
[
  { "slug": "my-project", "name": "My Project", "description": "..." }
]
```

Filter by the user's `apps` list (or return all if `apps` contains `"all"`).

### 2d: Register the task board router

Register the task board router in the main app file at the `/api/v1/taskboard` prefix.

### 2e: Set up the database and seed

The task board needs 6 tables/collections: `taskboard_tasks`, `taskboard_comments`, `taskboard_activity`, `taskboard_user_reads`, `taskboard_notifications`, and `taskboard_projects`. See `backend-reference/README.md` for the full schema and recommended indexes.

If using a relational database (PostgreSQL, MySQL), create a migration with the appropriate tables and columns. If using a document database (MongoDB, Firestore), the collections are created automatically on first write.

**Seed the initial project:** Either run the seed script or wire it into the app's startup so the project is auto-created if it doesn't exist. Name the project based on what this app does. The seed should be idempotent (skip if the project already exists).

### 2f: Verify the backend

Start the backend and test these endpoints to make sure they return data correctly:
- `GET /api/v1/taskboard/projects` — should return the seeded project
- `GET /api/v1/taskboard/tasks?project_slug=<slug>&per_column=10` — should return the column structure

## Step 3: Integrate the frontend

### 3a: Create the API client wrapper

The package expects an `ApiClient` interface with `get`, `post`, `patch`, and `delete` methods that return `{ data: T }`. If this app uses Axios, pass it directly — it already matches. If this app uses `fetch` or another HTTP library, create a thin wrapper:

```typescript
const apiClient = {
  get: async <T>(url: string) => {
    const res = await fetch(url);
    const data = await res.json();
    return { data: data as T };
  },
  post: async <T>(url: string, body?: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    return { data: data as T };
  },
  patch: async <T>(url: string, body?: unknown) => {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    return { data: data as T };
  },
  delete: async <T>(url: string) => {
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    return { data: data as T };
  },
};
```

Make sure auth headers (cookies, tokens, etc.) are included. If the app uses `credentials: 'include'` for cookies, add that to every fetch call.

### 3b: Import the CSS and configure Tailwind

Import `@emberai-engg/task-board/styles.css` in the app's global CSS or root layout.

**Critical for Tailwind v4:** Tailwind v4 skips `node_modules` by default, so the package's 300+ Tailwind utility classes won't be compiled. Check which version of Tailwind the app uses:

- **Tailwind v4** (uses `@tailwindcss/postcss`, no `tailwind.config` file): Add a `@source` directive in the app's global CSS file pointing to the package's dist folder, e.g. `@source "../node_modules/@emberai-engg/task-board/dist";`
- **Tailwind v3** (has `tailwind.config.js`/`tailwind.config.ts`): Add `"./node_modules/@emberai-engg/task-board/dist/**/*.{js,mjs}"` to the `content` array in the Tailwind config.

Without this step, the board will render but all styling will be broken.

### 3c: Create the task board page

Create a new page at `/task-board`. The page should:

- Wrap everything in `<TaskBoardProvider>` passing in the API client wrapper (with auth headers already configured) and the current logged-in user's info
- Render `<TaskBoard>` inside the provider
- Set up feature flags (drag-and-drop, comments, filters enabled; attachments disabled for now)
- Pass an `onError` callback for error visibility

**CRITICAL — Layout constraint:** `<TaskBoard>` uses `h-full` and `flex-1` internally, which means its parent container MUST have a **fixed/constrained height**. If the parent can grow unbounded, the 8 kanban columns (2300px+ wide) will push the container wider instead of scrolling horizontally. Use absolute positioning to constrain:

```tsx
<div className="relative" style={{ height: 'calc(100vh - <headerHeight>px)' }}>
  <div className="absolute inset-0 p-6 lg:p-10">
    <TaskBoardProvider ...>
      <TaskBoard />
    </TaskBoardProvider>
  </div>
</div>
```

Replace `<headerHeight>` with the app's actual header/navbar height. Do NOT rely on `flex-1` or `h-full` alone without a height-constrained ancestor.

**Scrollbar conflicts:** If the app uses a global `no-scrollbar` CSS class or utility that hides scrollbars, add this override in the app's global CSS to restore the board's horizontal scrollbar:

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

**User object:** The `user` prop on `<TaskBoardProvider>` MUST include ALL of these fields. Missing fields will cause runtime errors in the TaskDetailPanel:

```typescript
{
  username: string;    // Required — used for comment ownership checks
  name: string;        // Required — display name
  email: string;       // Required — shown in mentions
  apps: string[];      // Required — project access list, or ["all"]
  role?: string;       // Optional — "user", "org_admin", etc.
  is_reviewer?: boolean; // Optional — defaults to false
  is_internal?: boolean; // Optional but important — controls internal comments visibility
}
```

The package ships with built-in CreateTaskModal and TaskDetailPanel, so no render props are needed for a complete, polished UI. Just render `<TaskBoard />` inside the provider and it works out of the box.

If this app needs custom create/edit UI, render props (`renderCreateTask`, `renderTaskDetail`) are available as overrides. Only use these if the defaults don't fit.

Optionally, pass `onShareFeedback` callback to enable the Share Feedback button in the board header.

### 3d: Add navigation link

Add a "Task Board" link to the app's sidebar or navigation using the `KanbanIcon` exported from the package. Match the existing nav pattern.

## Step 4: Verify the integration

Start both backend and frontend dev servers, navigate to `/task-board`, and verify:

- Board renders with the seeded project
- Columns display correctly
- Creating a task works end to end
- Dragging tasks between columns works
- Task detail panel opens on click
- Comments can be added
- @mentions show user suggestions
- Notification bell works
- Tag filters work
- Loading skeletons appear during fetches
- Errors surface via the onError callback

## Important notes

- The package does NOT handle authentication. The API client you pass in should already have auth headers configured.
- The package uses Tailwind utility classes and relies on the consuming app's Tailwind setup. It does not bundle Tailwind.
- If the backend endpoints are at a different prefix than `/api/v1/taskboard`, pass the correct `apiBasePath` prop to TaskBoardProvider.
- Do NOT modify the package code in node_modules. If something doesn't work, we fix it in the package repo and publish a new version.
- Do NOT reference any local folders or paths outside this project. Everything comes from the npm package or the GitHub repo.
