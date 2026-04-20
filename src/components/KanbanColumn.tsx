import React, { useEffect, useRef } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import type { Task, ColumnConfig } from '../types';
import { TaskCard } from './TaskCard';
import { SkeletonCard } from './SkeletonPulse';
import { PlusIcon } from '../icons';

export interface KanbanColumnProps {
  column: ColumnConfig;
  tasks: Task[];
  totalCount: number;
  unreadCount: number;
  loadingMore: boolean;
  onAddTask: () => void;
  onTaskClick: (task: Task) => void;
  onTaskShare: (taskId: string, e: React.MouseEvent) => void;
  copiedTaskId: string | null;
  onLoadMore: () => void;
}

function LoadMoreSentinel({ loading, onLoadMore, remaining }: { loading: boolean; onLoadMore: () => void; remaining: number }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loading) onLoadMoreRef.current(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  const skeletonCount = loading ? Math.min(remaining, 10) : 0;

  return (
    <div ref={sentinelRef} className="space-y-2 pt-2">
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function KanbanColumn({
  column,
  tasks,
  totalCount,
  unreadCount,
  loadingMore,
  onAddTask,
  onTaskClick,
  onTaskShare,
  copiedTaskId,
  onLoadMore,
}: KanbanColumnProps) {
  return (
    <div className="w-[280px] flex flex-col shrink-0 h-full">
      {/* Column header */}
      <div className="mb-3 px-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${column.color}`} />
          <h3 className="text-xs font-medium text-neutral-700 uppercase tracking-wide">{column.label}</h3>
          {unreadCount > 0 && (
            <span className="relative group/unread-col w-4 h-4 rounded-full bg-[#FF5E00] text-white text-[9px] font-semibold flex items-center justify-center cursor-default">
              {unreadCount}
              <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-neutral-800 rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/unread-col:opacity-100 transition-opacity duration-75 z-10">
                {unreadCount} unread {unreadCount === 1 ? "task" : "tasks"}
              </span>
            </span>
          )}
          <span className="text-[10px] text-neutral-400 ml-auto">{totalCount}</span>
          <button
            onClick={onAddTask}
            className="ml-1 p-1 rounded-md text-neutral-400 hover:text-[#FF5E00] hover:bg-[#FF5E00]/10 transition-colors"
            aria-label={`Add task to ${column.label}`}
          >
            <PlusIcon size={16} />
          </button>
        </div>
        <p className="text-[10px] text-neutral-400 mt-0.5 pl-4">{column.description}</p>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={column.key}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 rounded-xl p-2 min-h-[120px] overflow-y-auto transition-colors ${
              snapshot.isDraggingOver ? "bg-[#FF5E00]/5 ring-1 ring-[#FF5E00]/20" : "bg-neutral-100/50"
            }`}
          >
            <div className="space-y-2">
              {tasks.map((task, index) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  index={index}
                  onClick={() => onTaskClick(task)}
                  onShare={(e) => { e.stopPropagation(); onTaskShare(task.id, e); }}
                  copied={copiedTaskId === task.id}
                />
              ))}
              {provided.placeholder}
            </div>

            {tasks.length < totalCount && (
              <LoadMoreSentinel
                loading={loadingMore}
                onLoadMore={onLoadMore}
                remaining={totalCount - tasks.length}
              />
            )}

            {tasks.length === 0 && (
              <div className="flex items-center justify-center h-20 text-xs text-neutral-400">
                No tasks
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
