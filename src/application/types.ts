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
  title: string;
  description: string;
  input: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  permission: Permission;
  risk: RiskLevel;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execute: (
    input: TInput,
    context: AppCommandContext
  ) => Promise<TOutput>;
}

export function defineAppCommand<
  TSchema extends z.ZodTypeAny,
  TOutput,
>(definition: {
  id: string;
  title: string;
  description: string;
  input: TSchema;
  output?: z.ZodType<TOutput>;
  permission: Permission;
  risk: RiskLevel;
  annotations?: AppCommandDefinition["annotations"];
  execute: (
    input: z.infer<TSchema>,
    context: AppCommandContext
  ) => Promise<TOutput>;
}): AppCommandDefinition<z.infer<TSchema>, TOutput> {
  return definition as AppCommandDefinition<z.infer<TSchema>, TOutput>;
}
