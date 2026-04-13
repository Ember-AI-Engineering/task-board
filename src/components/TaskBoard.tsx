import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import type { Task } from '../types';
import { useTaskBoardContext } from '../context/TaskBoardProvider';
import { useTaskBoard } from '../hooks/useTaskBoard';
import { useTaskActions } from '../hooks/useTaskActions';
import { useShareLink } from '../hooks/useShareLink';
import { PREDEFINED_TAGS } from '../utils/constants';
import { BoardSkeleton } from './SkeletonPulse';
import { KanbanColumn } from './KanbanColumn';
import { FilterBar } from './FilterBar';
import { NotificationBell } from './NotificationBell';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailPanel } from './TaskDetailPanel';
import { PlusIcon, XIcon, FeedbackIcon } from '../icons';

export interface TaskBoardProps {
  /** Optional class name for the outer container */
  className?: string;
  /** Optional header content (e.g., feedback link) to render in the header bar */
  headerActions?: React.ReactNode;
  /** Callback when a task detail panel should open */
  onTaskOpen?: (task: Task) => void;
  /** Callback for the Share Feedback button. If not provided, the button is hidden. */
  onShareFeedback?: () => void;
  /** Render function for the task detail panel. If omitted, uses built-in TaskDetailPanel. */
  renderTaskDetail?: (props: { task: Task; onClose: () => void; onUpdate: () => void }) => React.ReactNode;
  /** Render function for the create task modal. If omitted, uses built-in CreateTaskModal. */
  renderCreateTask?: (props: { projectSlug: string; defaultStatus: string; onClose: () => void; onCreate: () => void }) => React.ReactNode;
}

export function TaskBoard({
  className = "",
  headerActions,
  onTaskOpen,
  onShareFeedback,
  renderTaskDetail,
  renderCreateTask,
}: TaskBoardProps) {
  const { columns, features, service } = useTaskBoardContext();

  const board = useTaskBoard();
  const actions = useTaskActions(board.tasks, board.setTasks, board.fetchTasks);
  const { copiedTaskId, copyShareLink } = useShareLink();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createForStatus, setCreateForStatus] = useState("");
  const [filterTags, setFilterTags] = useState<string[]>([]);

  // Handle shared task URL (?task=id)
  const [sharedTaskHandled, setSharedTaskHandled] = useState(false);
  useEffect(() => {
    if (sharedTaskHandled || !board.selectedProject || board.boardLoading) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("task");
    if (!taskId) return;
    setSharedTaskHandled(true);
    let cancelled = false;
    (async () => {
      try {
        const task = await service.getTask(taskId);
        if (cancelled) return;
        setSelectedTask(task);
        service.markTaskRead(taskId).catch(() => {});
        const url = new URL(window.location.href);
        url.searchParams.delete("task");
        window.history.replaceState({}, "", url.toString());
      } catch {
        if (!cancelled) board.setError("Could not open shared task.");
      }
    })();
    return () => { cancelled = true; };
  }, [board.selectedProject, board.boardLoading, sharedTaskHandled, service]);

  // Update URL when project changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (board.selectedProject && board.projects.length > 1) {
      const url = new URL(window.location.href);
      url.searchParams.set("project", board.selectedProject);
      window.history.replaceState({}, "", url.toString());
    }
  }, [board.selectedProject, board.projects]);

  const handleDragEnd = useCallback((result: DropResult) => {
    const { draggableId, source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    actions.moveTask(
      draggableId,
      source.droppableId,
      destination.droppableId,
      source.index,
      destination.index
    );
  }, [actions]);

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    onTaskOpen?.(task);
    actions.markTaskRead(task.id);
    // Optimistically clear unread
    if (task.has_unread) {
      board.setTasks((prev) => {
        const updated = { ...prev };
        const col = updated[task.status];
        if (col) {
          updated[task.status] = col.map((t) =>
            t.id === task.id ? { ...t, has_unread: false } : t
          );
        }
        return updated;
      });
      board.setColumnUnreads((prev) => ({
        ...prev,
        [task.status]: Math.max(0, (prev[task.status] || 0) - 1),
      }));
    }
  };

  const handleOpenTaskFromNotification = async (taskId: string, projectSlug: string) => {
    if (board.selectedProject !== projectSlug) {
      board.setSelectedProject(projectSlug);
    }
    try {
      const task = await service.getTask(taskId);
      setSelectedTask(task);
      service.markTaskRead(taskId).catch(() => {});
    } catch {
      board.setError("Could not open task.");
    }
  };

  const predefinedValues = PREDEFINED_TAGS.map((p) => p.value);

  // Built-in create/detail handlers
  const handleCreateClose = () => setCreateForStatus("");
  const handleCreateDone = () => { board.fetchTasks(); board.showSuccess("Task created"); };
  const handleDetailClose = () => setSelectedTask(null);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="mb-4 sm:mb-6 shrink-0">
        <div className="flex items-center justify-between mb-1 sm:mb-2">
          <h1 className="text-2xl sm:text-3xl font-medium text-neutral-900 tracking-tight">
            Task Board
          </h1>
          <div className="flex items-center gap-2">
            {onShareFeedback && (
              <button
                onClick={onShareFeedback}
                className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 px-3 py-2 sm:py-2.5 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors"
              >
                <FeedbackIcon size={16} />
                <span className="hidden sm:inline">Share Feedback</span>
              </button>
            )}
            {headerActions}
            {features.notifications && (
              <NotificationBell onOpenTask={handleOpenTaskFromNotification} />
            )}
            {board.projects.length > 0 && (
              <button
                onClick={() => setCreateForStatus("backlog")}
                className="flex items-center gap-1.5 sm:gap-2 text-xs font-semibold text-white bg-[#FF5E00] hover:bg-[#E05200] px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg transition-colors shadow-sm"
              >
                <PlusIcon size={16} />
                <span className="hidden sm:inline">New Task</span>
                <span className="sm:hidden">New</span>
              </button>
            )}
          </div>
        </div>
        <p className="text-neutral-500 font-light text-sm sm:text-lg">
          Track and manage work across projects.
        </p>
      </div>

      {/* Success / Error */}
      {board.successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {board.successMessage}
        </div>
      )}
      {board.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center justify-between">
          {board.error}
          <button onClick={() => board.setError("")} className="text-red-400 hover:text-red-600">
            <XIcon size={16} />
          </button>
        </div>
      )}

      {board.projects.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-medium text-neutral-900 mb-2">No Projects Available</h2>
            <p className="text-neutral-500">You don&apos;t have access to any projects yet.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <FilterBar
            projects={board.projects}
            selectedProject={board.selectedProject}
            onSelectProject={board.setSelectedProject}
            filterTags={filterTags}
            onSetFilterTags={setFilterTags}
          />

          {/* Board */}
          {board.boardLoading ? (
            <BoardSkeleton />
          ) : (
            <div className="flex-1 min-h-0 eb-tb-board-scroll overflow-y-hidden pb-4">
              <DragDropContext onDragEnd={handleDragEnd}>
                <div className="flex gap-4 min-w-max h-full">
                  {columns.map((col) => {
                    const allColumnTasks = board.tasks[col.key] || [];
                    const columnTasks = filterTags.length > 0
                      ? allColumnTasks.filter((t) => {
                          const taskTags = t.tags || [];
                          return filterTags.some((f) => {
                            if (f === "__other__") return taskTags.some((tag) => !predefinedValues.includes(tag));
                            return taskTags.includes(f);
                          });
                        })
                      : allColumnTasks;

                    return (
                      <KanbanColumn
                        key={col.key}
                        column={col}
                        tasks={columnTasks}
                        totalCount={board.columnTotals[col.key] || 0}
                        unreadCount={board.columnUnreads[col.key] || 0}
                        loadingMore={board.loadingMore[col.key] || false}
                        onAddTask={() => setCreateForStatus(col.key)}
                        onTaskClick={handleTaskClick}
                        onTaskShare={(taskId, e) => copyShareLink(taskId, board.selectedProject)}
                        copiedTaskId={copiedTaskId}
                        onLoadMore={() => board.loadMoreTasks(col.key)}
                      />
                    );
                  })}
                </div>
              </DragDropContext>
            </div>
          )}
        </>
      )}

      {/* Create Task Modal — render prop override or built-in */}
      {createForStatus && (
        renderCreateTask
          ? renderCreateTask({
              projectSlug: board.selectedProject,
              defaultStatus: createForStatus,
              onClose: handleCreateClose,
              onCreate: handleCreateDone,
            })
          : <CreateTaskModal
              projectSlug={board.selectedProject}
              defaultStatus={createForStatus}
              onClose={handleCreateClose}
              onCreate={handleCreateDone}
            />
      )}

      {/* Task Detail — render prop override or built-in */}
      {selectedTask && (
        renderTaskDetail
          ? renderTaskDetail({
              task: selectedTask,
              onClose: handleDetailClose,
              onUpdate: board.fetchTasks,
            })
          : <TaskDetailPanel
              task={selectedTask}
              projectSlug={board.selectedProject}
              onClose={handleDetailClose}
              onUpdate={board.fetchTasks}
            />
      )}
    </div>
  );
}
