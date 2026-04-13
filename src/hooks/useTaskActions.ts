import { useCallback, useRef } from 'react';
import type { Task, TasksByStatus, CreateTaskPayload, UpdateTaskPayload } from '../types';
import { useTaskBoardContext } from '../context/TaskBoardProvider';
import { POSITION_GAP } from '../utils/constants';

export function useTaskActions(
  tasks: TasksByStatus,
  setTasks: React.Dispatch<React.SetStateAction<TasksByStatus>>,
  fetchTasks: () => Promise<void>,
  isDragging?: React.RefObject<boolean>,
) {
  const { service, config } = useTaskBoardContext();

  const internalDragging = useRef(false);
  const draggingRef = isDragging ?? internalDragging;

  const createTask = useCallback(async (data: CreateTaskPayload): Promise<Task> => {
    const task = await service.createTask(data);
    config.onTaskCreate?.(task);
    await fetchTasks();
    return task;
  }, [service, config, fetchTasks]);

  const updateTask = useCallback(async (taskId: string, data: UpdateTaskPayload): Promise<Task> => {
    const task = await service.updateTask(taskId, data);
    config.onTaskUpdate?.(task);
    await fetchTasks();
    return task;
  }, [service, config, fetchTasks]);

  const deleteTask = useCallback(async (taskId: string): Promise<void> => {
    await service.deleteTask(taskId);
    config.onTaskDelete?.(taskId);
    await fetchTasks();
  }, [service, config, fetchTasks]);

  const markTaskRead = useCallback(async (taskId: string): Promise<void> => {
    service.markTaskRead(taskId).catch(() => {});
  }, [service]);

  const moveTask = useCallback(async (
    taskId: string,
    sourceStatus: string,
    destStatus: string,
    sourceIndex: number,
    destIndex: number,
  ) => {
    draggingRef.current = true;

    // Calculate position and apply optimistic update via functional updater
    let newPosition = POSITION_GAP;

    setTasks((prev) => {
      const sourceCol = [...(prev[sourceStatus] || [])];
      const destCol = sourceStatus === destStatus ? sourceCol : [...(prev[destStatus] || [])];

      const [movedTask] = sourceCol.splice(sourceIndex, 1);
      if (!movedTask) return prev;

      const updatedTask = { ...movedTask, status: destStatus };
      destCol.splice(destIndex, 0, updatedTask);

      // Calculate position
      if (destCol.length === 1) {
        newPosition = POSITION_GAP;
      } else if (destIndex === 0) {
        newPosition = (destCol[1]?.position ?? POSITION_GAP) - POSITION_GAP;
      } else if (destIndex === destCol.length - 1) {
        newPosition = (destCol[destCol.length - 2]?.position ?? 0) + POSITION_GAP;
      } else {
        const above = destCol[destIndex - 1]?.position ?? 0;
        const below = destCol[destIndex + 1]?.position ?? above + POSITION_GAP * 2;
        newPosition = (above + below) / 2;
      }
      updatedTask.position = newPosition;

      const newTasks = { ...prev };
      newTasks[sourceStatus] = sourceCol;
      if (sourceStatus !== destStatus) {
        newTasks[destStatus] = destCol;
      }
      return newTasks;
    });

    // Persist to backend
    try {
      await service.updateTask(taskId, { status: destStatus, position: newPosition });
    } catch {
      fetchTasks();
    } finally {
      draggingRef.current = false;
    }
  }, [setTasks, service, fetchTasks]);

  return { createTask, updateTask, deleteTask, markTaskRead, moveTask };
}
