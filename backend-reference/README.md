# Task Board Backend — Reference Implementation

This is a **Python FastAPI + MongoDB** reference implementation for the `@codewusama/task-board` frontend package. It is not a runnable package — copy these files into your app's backend and adapt them.

## What to adapt

| File | What to change |
|------|---------------|
| `dependencies/tenant.py` | Replace `decode_token` and `DatabaseManager` with your app's auth and DB layer |
| `api/taskboard.py` | Update the import paths for dependencies and models to match your app |
| `models/taskboard.py` | Ready to use as-is, or extend with additional fields |
| `scripts/seed_projects.py` | Replace the `PROJECTS` list and database name pattern |

## Endpoints (16)

### Tasks (7)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/taskboard/tasks` | List tasks grouped by column with pagination |
| `GET` | `/api/v1/taskboard/tasks/column` | Paginated tasks for a single column |
| `POST` | `/api/v1/taskboard/tasks` | Create a new task |
| `GET` | `/api/v1/taskboard/tasks/{task_id}` | Get task detail with comments and activity |
| `PATCH` | `/api/v1/taskboard/tasks/{task_id}` | Update task fields (title, status, priority, etc.) |
| `DELETE` | `/api/v1/taskboard/tasks/{task_id}` | Delete task and its comments |
| `POST` | `/api/v1/taskboard/tasks/{task_id}/read` | Mark task as read for current user |

### Comments (4)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/taskboard/tasks/{task_id}/comments` | Add a comment |
| `GET` | `/api/v1/taskboard/tasks/{task_id}/comments` | List comments |
| `PATCH` | `/api/v1/taskboard/tasks/{task_id}/comments/{comment_id}` | Edit a comment (author only) |
| `DELETE` | `/api/v1/taskboard/tasks/{task_id}/comments/{comment_id}` | Delete a comment (author or admin) |

### Mentions (1)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/taskboard/mentions/users` | Search users for @mention autocomplete |

### Notifications (4)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/taskboard/notifications/count` | Unread notification count |
| `GET` | `/api/v1/taskboard/notifications` | List notifications |
| `PATCH` | `/api/v1/taskboard/notifications/{notification_id}/read` | Mark one as read |
| `POST` | `/api/v1/taskboard/notifications/read-all` | Mark all as read |

## MongoDB Collections

| Collection | Description |
|------------|-------------|
| `taskboard_tasks` | Tasks with title, description, status, priority, position, tags |
| `taskboard_comments` | Comments on tasks, supports internal-only comments |
| `taskboard_activity` | Activity log (status changes, creation events) |
| `taskboard_user_reads` | Per-user read timestamps for unread indicators |
| `taskboard_notifications` | @mention notifications |
| `taskboard_projects` | Project definitions (slug, name, description) |

### Recommended indexes

```javascript
db.taskboard_tasks.createIndex({ project_slug: 1, status: 1, position: 1 })
db.taskboard_tasks.createIndex({ project_slug: 1, position: 1 })
db.taskboard_comments.createIndex({ task_id: 1, created_at: 1 })
db.taskboard_activity.createIndex({ task_id: 1, created_at: 1 })
db.taskboard_user_reads.createIndex({ task_id: 1, username: 1 }, { unique: true })
db.taskboard_notifications.createIndex({ recipient: 1, read: 1, created_at: -1 })
db.taskboard_projects.createIndex({ slug: 1 }, { unique: true })
```

## User dict contract

The API expects `get_current_user()` to return a dict with these fields:

```python
{
    "username": "jsmith",          # Unique identifier
    "name": "Jane Smith",          # Display name
    "email": "jane@example.com",   # Email
    "role": "user",                # "user", "org_admin", or "super_admin"
    "apps": ["project-alpha"],     # Project slugs user can access, or ["all"]
    "org_slug": "acme-corp",       # Tenant identifier
    "is_reviewer": False,          # Reviewer privileges
    "is_internal": False,          # Can see internal comments
}
```

## Wiring into your FastAPI app

```python
from fastapi import FastAPI
from your_app.api.taskboard import router as taskboard_router

app = FastAPI()
app.include_router(taskboard_router)
```

## Seed script

```bash
MONGODB_URI="mongodb://localhost:27017" python -m app.scripts.seed_projects --org-slug your-org
```

Edit the `PROJECTS` list in `scripts/seed_projects.py` before running.

## Python dependencies

```
fastapi
pydantic
motor           # async MongoDB driver
pymongo[srv]    # MongoDB connection
```
