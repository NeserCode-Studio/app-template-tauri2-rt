import type { z } from "zod";

export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type Permission = "read" | "write" | "admin";

export interface TaskProgress {
  progress: number;
  total?: number;
  message?: string;
}

export interface TaskProgressReporter {
  report: (progress: TaskProgress) => void;
}

export interface AppCommandContext {
  root: string | null;
  workId: string | null;
  permission: Permission;
  signal: AbortSignal;
  progress: TaskProgressReporter;
}

export interface CommandErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export interface CommandSuccess<T> {
  ok: true;
  data: T;
}

export interface CommandFailure {
  ok: false;
  error: CommandErrorShape;
}

export type CommandResult<T> = CommandSuccess<T> | CommandFailure;

export interface AppCommandDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  input: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  permission: Permission;
  risk: RiskLevel;
  execute: (
    input: TInput,
    context: AppCommandContext
  ) => Promise<TOutput>;
}
