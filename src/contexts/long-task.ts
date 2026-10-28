import { createContext, useContext } from "react";

export interface LongTaskDescriptor {
  title: string;
  description?: string;
  detail?: string;
  done?: number;
  total?: number;
}

export interface LongTaskState extends LongTaskDescriptor {
  id: string;
}

export interface LongTaskHandle {
  update: (patch: Partial<LongTaskDescriptor>) => void;
  finish: () => void;
}

export interface LongTaskContextValue {
  run: <T>(
    descriptor: LongTaskDescriptor,
    operation: (task: LongTaskHandle) => Promise<T>
  ) => Promise<T>;
}

export const LongTaskContext = createContext<LongTaskContextValue | null>(null);

export function useLongTask(): LongTaskContextValue {
  const context = useContext(LongTaskContext);
  if (!context)
    throw new Error("useLongTask must be used within LongTaskProvider");
  return context;
}
