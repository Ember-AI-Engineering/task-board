# Claude Code Prompt: Integrate @ember-ai-formerly-snapdev/task-board

## Context

We've published a reusable Kanban task board package `@ember-ai-formerly-snapdev/task-board` on GitHub Packages. It provides a fully functional task board with drag-and-drop, @mentions, notifications, filtering, infinite scroll, and more. We need to integrate it into this application.

The package exports a `<TaskBoardProvider>` that accepts the app's API client and user info, and a `<TaskBoard>` component that renders the full board UI.

The backend reference implementation (Python FastAPI) is in the same repo at `github.com/Ember-AI-Formerly-Snapdev/task-board` under the `backend-reference/` folder.

---

## Step 1: Configure npm to pull from GitHub Packages

Create or update `.npmrc` in the project root to point the `@ember-ai-formerly-snapdev` scope at GitHub Packages. The `GITHUB_TOKEN` env var needs `read:packages` scope.

## Step 2: Install the package

Install `@ember-ai-formerly-snapdev/task-board` from the registry and verify the `dist/` folder contains `index.js`, `index.mjs`, `index.d.ts`, and `styles.css`.

## Step 3: Set up the backend task board endpoints

The package's frontend expects 16 REST API endpoints. Identify the backend framework used in this app and proceed accordingly.

### 3a: Get the backend reference

Clone or fetch the reference implementation from `https://github.com/Ember-AI-Formerly-Snapdev/task-board`. The backend code is in the `backend-reference/` folder. It contains:

- `api/taskboard.py` — 16 REST endpoints
- `models/taskboard.py` — Data models and constants
- `dependencies/tenant.py` — Auth/tenant dependency (must be adapted to this app's auth)
- `scripts/seed_projects.py` — Seed script for initial projects

Read `backend-reference/README.md` for full details on each file and what needs adapting.

### 3b: Copy and adapt

Copy the backend reference files into the equivalent locations in this app's backend. Adapt:

- Import paths to match this app's module structure
- Auth/tenant dependency to match this app's existing auth approach
- Database connection to match this app's existing DB setup

**Database adaptation:** The reference implementation uses **MongoDB** (via Motor async driver). If this app uses a different database, you MUST rewrite the data access layer to match. The API request/response contracts must stay the same — only the storage layer changes. Here's how to adapt for common databases:

- **PostgreSQL / MySQL (SQLAlchemy):** Replace MongoDB collection calls with SQLAlchemy ORM models and queries. Create tables for `taskboard_tasks`, `taskboard_comments`, `taskboard_activity`, `taskboard_user_reads`, `taskboard_notifications`, and `taskboard_projects`. Use auto-incrementing IDs or UUIDs instead of ObjectId. Replace `insert_one` → `session.add()`, `find` → `session.query()`, `update_one` → `session.execute(update(...))`, `delete_one` → `session.delete()`.
- **PostgreSQL (asyncpg / raw SQL):** Write async queries directly. The collection names map to table names. Create appropriate indexes matching those listed in `backend-reference/README.md`.
- **DynamoDB:** Use partition keys (e.g., `project_slug#status` for tasks) and sort keys (`position`). Notifications need a GSI on `recipient + read + created_at`.
- **Firestore:** Map collections 1:1. Use subcollections for comments under tasks if preferred. Replace ObjectId with Firestore auto-IDs.
- **Prisma ORM:** Define models in `schema.prisma` matching the 6 collections, then use the Prisma client in the route handlers.

The key contract the frontend expects:
- `GET /tasks` returns `{ [status]: { tasks: [...], total: N, unread: N } }`
- `GET /tasks/{id}` returns the task with `comments` and `activity` arrays
- All IDs are strings
- All dates are ISO 8601 strings
- The `_serialize_doc` pattern (converting DB-native IDs to string `id` fields) must be replicated in whatever ORM/driver you use

### 3c: Register the task board router

Register the task board router in the main app file at the `/api/taskboard` prefix.

### 3d: Set up the database

The task board needs 6 tables/collections: `taskboard_tasks`, `taskboard_comments`, `taskboard_activity`, `taskboard_user_reads`, `taskboard_notifications`, and `taskboard_projects`. See `backend-reference/README.md` for the full schema and recommended indexes.

If using a relational database (PostgreSQL, MySQL), create a migration with the appropriate tables and columns. If using a document database (MongoDB, Firestore), the collections are created automatically on first write.

Run the seed script or manually create the initial project. Name the project based on what this app does.

### 3e: Verify the backend

Start the backend and test the projects, columns, and tasks endpoints to make sure they return data correctly.

## Step 4: Integrate the frontend

### 4a: Import the CSS and configure Tailwind

Import `@ember-ai-formerly-snapdev/task-board/styles.css` in the app's global CSS or root layout.

**Critical for Tailwind v4:** Tailwind v4 skips `node_modules` by default, so the package's 300+ Tailwind utility classes won't be compiled. Check which version of Tailwind the app uses:

- **Tailwind v4** (uses `@tailwindcss/postcss`, no `tailwind.config` file): Add a `@source` directive in the app's global CSS file pointing to the package's dist folder, e.g. `@source "../node_modules/@ember-ai-formerly-snapdev/task-board/dist";`
- **Tailwind v3** (has `tailwind.config.js`/`tailwind.config.ts`): Add `"./node_modules/@ember-ai-formerly-snapdev/task-board/dist/**/*.{js,mjs}"` to the `content` array in the Tailwind config.

Without this step, the board will render but all styling will be broken.

### 4b: Create the task board page

Create a new page at `/task-board`. The page should:

- Wrap everything in `<TaskBoardProvider>` passing in the app's existing API client (with auth headers already configured) and the current logged-in user's info
- Render `<TaskBoard>` inside the provider
- Set up feature flags (drag-and-drop, comments, filters enabled; attachments disabled for now)
- Pass an `onError` callback for error visibility
- Add comfortable padding on all sides of the page container so the board doesn't sit flush against the edges. Match the padding used on other pages in the app. If no reference exists, use at least `p-6` or equivalent.

The package ships with built-in CreateTaskModal and TaskDetailPanel, so no render props are needed for a complete, polished UI. Just render `<TaskBoard />` inside the provider and it works out of the box.

If this app needs custom create/edit UI, render props (`renderCreateTask`, `renderTaskDetail`) are available as overrides. Only use these if the defaults don't fit.

Optionally, pass `onShareFeedback` callback to enable the Share Feedback button in the board header.

### 4c: Add navigation link

Add a "Task Board" link to the app's sidebar or navigation using the `KanbanIcon` exported from the package. Match the existing nav pattern.

## Step 5: Verify the integration

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
- If the backend endpoints are at a different prefix than `/api/taskboard`, pass the correct `apiBasePath` prop to TaskBoardProvider.
- Do NOT modify the package code in node_modules. If something doesn't work, we fix it in the package repo and publish a new version.
- Do NOT reference any local folders or paths outside this project. Everything comes from the npm package or the GitHub repo.
