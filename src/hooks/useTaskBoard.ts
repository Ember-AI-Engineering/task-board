import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Task, TasksByStatus, ColumnTotals, ColumnUnreads, Project } from '../types';
import { useTaskBoardContext } from '../context/TaskBoardProvider';
import { DEFAULT_PAGE_SIZE } from '../utils/constants';

export function useTaskBoard(isDragging?: React.RefObject<boolean>) {
  const { service, user, projects: configProjects, columns, config } = useTaskBoardContext();

  const [fetchedProjects, setFetchedProjects] = useState<Project[]>([]);

  // Fetch projects from API when none are provided via props
  useEffect(() => {
    if (configProjects.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await service.listProjects();
        if (!cancelled) setFetchedProjects(data);
      } catch {
        // Projects endpoint may not exist — fall back to empty
      }
    })();
    return () => { cancelled = true; };
  }, [configProjects, service]);

  const projects = configProjects.length > 0 ? configProjects : fetchedProjects;

  const [selectedProject, setSelectedProject] = useState("");
  const [tasks, setTasks] = useState<TasksByStatus>({});
  const [columnTotals, setColumnTotals] = useState<ColumnTotals>({});
  const [columnUnreads, setColumnUnreads] = useState<ColumnUnreads>({});
  const [boardLoading, setBoardLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Auto-select project from URL or first available
  useEffect(() => {
    if (selectedProject || projects.length === 0) return;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlProject = params.get("project");
      if (urlProject && projects.find((p) => p.slug === urlProject)) {
        setSelectedProject(urlProject);
        return;
      }
    }
    setSelectedProject(projects[0].slug);
  }, [projects, selectedProject]);

  const fetchTasks = useCallback(async () => {
    if (!selectedProject) return;
    setBoardLoading(true);
    try {
      const data = await service.listTasks(selectedProject, DEFAULT_PAGE_SIZE);
      const newTasks: TasksByStatus = {};
      const newTotals: ColumnTotals = {};
      const newUnreads: ColumnUnreads = {};
      for (const key of columns.map((c) => c.key)) {
        const col = data[key];
        if (col) {
          newTasks[key] = col.tasks || [];
          newTotals[key] = col.total || 0;
          newUnreads[key] = col.unread || 0;
        } else {
          newTasks[key] = [];
          newTotals[key] = 0;
          newUnreads[key] = 0;
        }
      }
      setTasks(newTasks);
      setColumnTotals(newTotals);
      setColumnUnreads(newUnreads);
    } catch {
      setError("Failed to load tasks");
    } finally {
      setBoardLoading(false);
    }
  }, [selectedProject, service, columns]);

  useEffect(() => {
    if (isDragging?.current) return;
    fetchTasks();
  }, [fetchTasks, isDragging]);

  const loadMoreTasks = useCallback(async (statusKey: string) => {
    if (!selectedProject || loadingMore[statusKey]) return;
    const current = tasks[statusKey]?.length || 0;
    const total = columnTotals[statusKey] || 0;
    if (current >= total) return;

    setLoadingMore((prev) => ({ ...prev, [statusKey]: true }));
    try {
      const newTasks = await service.listColumnTasks(
        selectedProject, statusKey, current, DEFAULT_PAGE_SIZE
      );
      setTasks((prev) => ({
        ...prev,
        [statusKey]: [...(prev[statusKey] || []), ...newTasks],
      }));
    } catch (err) {
      config.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingMore((prev) => ({ ...prev, [statusKey]: false }));
    }
  }, [selectedProject, tasks, columnTotals, loadingMore, service, config]);

  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setSuccessMessage(""), 3000);
  };

  return {
    projects,
    selectedProject,
    setSelectedProject,
    tasks,
    setTasks,
    columnTotals,
    setColumnTotals,
    columnUnreads,
    setColumnUnreads,
    boardLoading,
    loadingMore,
    error,
    setError,
    successMessage,
    showSuccess,
    fetchTasks,
    loadMoreTasks,
  };
}
