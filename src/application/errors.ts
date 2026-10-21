export type AppErrorCode =
  | "workspace_not_ready"
  | "no_current_work"
  | "not_found"
  | "invalid_argument"
  | "permission_denied"
  | "confirmation_required"
  | "revision_conflict"
  | "chapter_busy"
  | "bridge_unavailable"
  | "cancelled"
  | "rate_limited"
  | "operation_failed";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export class RevisionConflictError extends AppError {
  readonly currentRevision: number;
  readonly updatedAt: number;

  constructor(currentRevision: number, updatedAt: number) {
    super(
      "revision_conflict",
      `Chapter changed on disk (current revision ${currentRevision}). Reload it before writing.`,
      { currentRevision, updatedAt }
    );
    this.name = "RevisionConflictError";
    this.currentRevision = currentRevision;
    this.updatedAt = updatedAt;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown operation error";
}

export function toCommandError(value: unknown) {
  if (isAppError(value)) {
    return {
      code: value.code,
      message: value.message,
      details: value.details,
    };
  }
  return {
    code: "operation_failed" as const,
    message: errorMessage(value),
  };
}
