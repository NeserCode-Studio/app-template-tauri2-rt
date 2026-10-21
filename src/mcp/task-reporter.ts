import type { TaskProgress, TaskProgressReporter } from "@/application/types";

export class McpTaskReporter implements TaskProgressReporter {
  private lastSentAt = 0;
  private lastProgress = -1;

  constructor(
    private readonly send: (progress: TaskProgress) => void
  ) {}

  report(progress: TaskProgress): void {
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

  finish(total = this.lastProgress): void {
    this.report({
      progress: total,
      total,
      message: "Completed",
    });
  }
}
