import type { TaskProgress, TaskProgressReporter } from "@/application/types";

export class McpTaskReporter implements TaskProgressReporter {
  private lastSentAt = 0;
  private lastProgress = -1;
  private lastTotal: number | undefined;

  constructor(private readonly send: (progress: TaskProgress) => void) {}

  report(progress: TaskProgress): void {
    this.lastTotal = progress.total;
    const now = Date.now();
    const terminal =
      progress.total !== undefined && progress.progress >= progress.total;
    if (
      !terminal &&
      progress.progress === this.lastProgress &&
      now - this.lastSentAt < 100
    ) {
      return;
    }
    this.lastProgress = progress.progress;
    this.lastSentAt = now;
    this.send(progress);
  }

  finish(total = this.lastTotal ?? Math.max(1, this.lastProgress)): void {
    const terminal = Math.max(0, total);
    this.report({
      progress: terminal,
      total: terminal,
      message: "Completed",
    });
  }
}
