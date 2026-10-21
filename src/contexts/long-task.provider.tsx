import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import LongTaskOverlay from "@/components/framework/LongTaskOverlay";
import {
  LongTaskContext,
  type LongTaskContextValue,
  type LongTaskDescriptor,
  type LongTaskHandle,
  type LongTaskState,
} from "./long-task";

export function LongTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<LongTaskState[]>([]);
  const active = tasks.at(-1) ?? null;
  const activeId = active?.id ?? null;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!activeId) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [activeId]);

  const begin = useCallback(
    (descriptor: LongTaskDescriptor): LongTaskHandle => {
      const id = crypto.randomUUID();
      setTasks((prev) => [...prev, { ...descriptor, id }]);
      return {
        update: (patch) => {
          setTasks((prev) =>
            prev.map((task) => (task.id === id ? { ...task, ...patch } : task))
          );
        },
        finish: () => {
          setTasks((prev) => prev.filter((task) => task.id !== id));
        },
      };
    },
    []
  );

  const run = useCallback(
    async <T,>(
      descriptor: LongTaskDescriptor,
      operation: (task: LongTaskHandle) => Promise<T>
    ): Promise<T> => {
      const task = begin(descriptor);
      try {
        return await operation(task);
      } finally {
        task.finish();
      }
    },
    [begin]
  );

  const value = useMemo<LongTaskContextValue>(() => ({ run }), [run]);

  return (
    <LongTaskContext.Provider value={value}>
      {children}
      <LongTaskOverlay task={active} visible={visible} />
    </LongTaskContext.Provider>
  );
}
