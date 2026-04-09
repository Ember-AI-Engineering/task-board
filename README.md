# @codewusama/task-board

Reusable Kanban task board component for Ember AI applications.

## Installation

```bash
npm install @codewusama/task-board
```

## Quick Start

```tsx
import { TaskBoardProvider, TaskBoard } from '@codewusama/task-board';
import '@codewusama/task-board/styles.css';
import { apiClient } from './lib/api';

function App() {
  const user = useAuth();

  return (
    <TaskBoardProvider
      apiClient={apiClient}
      user={{
        username: user.username,
        name: user.name,
        email: user.email,
        apps: user.apps,
        is_internal: user.is_internal,
        is_reviewer: user.is_reviewer,
      }}
      projects={[
        { slug: 'my-project', name: 'My Project' },
      ]}
    >
      <TaskBoard />
    </TaskBoardProvider>
  );
}
```

## Props / Config Reference

### `TaskBoardProvider`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `apiClient` | `ApiClient` | Yes | Axios-like HTTP client with auth headers |
| `user` | `TaskBoardUser` | Yes | Current logged-in user |
| `projects` | `Project[]` | No | Available projects |
| `columns` | `ColumnConfig[]` | No | Column definitions (defaults to 8-column kanban) |
| `priorities` | `PriorityConfig[]` | No | Priority levels |
| `tags` | `TagConfig[]` | No | Predefined tags |
| `apiBasePath` | `string` | No | API prefix (defaults to `/api/v1/taskboard`) |
| `features` | `object` | No | Feature flags for enabling/disabling features |
| `onTaskCreate` | `(task) => void` | No | Callback on task creation |
| `onTaskUpdate` | `(task) => void` | No | Callback on task update |
| `onTaskDelete` | `(id) => void` | No | Callback on task deletion |
| `onError` | `(error) => void` | No | Error handler callback |

### `TaskBoard`

| Prop | Type | Description |
|------|------|-------------|
| `className` | `string` | CSS class for the outer container |
| `headerActions` | `ReactNode` | Additional buttons in the header |
| `renderTaskDetail` | `function` | Custom render for task detail panel |
| `renderCreateTask` | `function` | Custom render for create task modal |

## Using Individual Components

```tsx
import { TaskCard, PriorityBadge, UserAvatar, useTaskActions } from '@codewusama/task-board';

// Use hooks independently
function MyCustomUI() {
  const { createTask, moveTask } = useTaskActions(tasks, setTasks, fetchTasks);
  // ...
}

// Use small components
<PriorityBadge priority="high" />
<UserAvatar name="John Smith" size="sm" showTooltip />
```

## Hooks API

| Hook | Purpose |
|------|---------|
| `useTaskBoard()` | Board state: projects, tasks, loading, pagination |
| `useTaskActions(tasks, setTasks, fetchTasks)` | CRUD: create, update, delete, move tasks |
| `useTaskDetail(taskId)` | Single task: comments, activity, field updates |
| `useShareLink()` | Copy shareable task URLs |

## Feature Flags

```tsx
<TaskBoardProvider
  features={{
    dragAndDrop: true,      // Drag-and-drop between columns
    comments: true,         // Comment system
    mentions: true,         // @mention users
    notifications: true,    // Notification bell
    internalComments: true, // Internal-only comments
    tags: true,             // Tag system
    sharing: true,          // Shareable task links
    filters: true,          // Tag filtering
    unreadIndicators: true, // Unread dots on cards
  }}
/>
```

## Development

```bash
cd packages/task-board
npm install
npm run dev    # Watch mode
npm run build  # Production build
npm test       # Run tests
```

## Backend

The `backend-reference/` folder contains a Python FastAPI reference implementation for the task board API. Copy it into your app's backend and adapt the auth and database setup to match your app. See [`backend-reference/README.md`](backend-reference/README.md) for details.

## License

Private — internal use only.
