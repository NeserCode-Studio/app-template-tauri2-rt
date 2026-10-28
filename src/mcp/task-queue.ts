export class TaskQueue {
  private active = 0;
  private readonly pending: Array<() => void> = [];
  private nextStartAt = 0;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly concurrency: number,
    private readonly minStartIntervalMs = 0
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("TaskQueue concurrency must be a positive integer.");
    }
    if (!Number.isFinite(minStartIntervalMs) || minStartIntervalMs < 0) {
      throw new Error("TaskQueue interval must be a non-negative number.");
    }
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        this.nextStartAt = Date.now() + this.minStartIntervalMs;
        void operation()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.startNext();
          });
      };

      this.pending.push(start);
      this.startNext();
    });
  }

  private startNext(): void {
    if (this.active >= this.concurrency) return;
    if (!this.pending.length) return;
    const waitMs = this.nextStartAt - Date.now();
    if (waitMs > 0) {
      if (!this.startTimer) {
        this.startTimer = setTimeout(() => {
          this.startTimer = null;
          this.startNext();
        }, waitMs);
      }
      return;
    }
    const start = this.pending.shift();
    if (!start) return;
    start();
    this.startNext();
  }
}
