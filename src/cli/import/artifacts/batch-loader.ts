type Pending<Input, Output> = {
  input: Input;
  resolve: (value: Output | undefined) => void;
  reject: (error: unknown) => void;
};

/** Shared memoized, same-tick coalescing extracted from CurrentRowReader. */
export class BatchLoader<Input, Output> {
  private readonly cache = new Map<string, Promise<Output | undefined>>();
  private readonly pending = new Map<string, Pending<Input, Output>>();
  private flushScheduled = false;
  private failure: { error: unknown } | undefined;

  constructor(
    private readonly key: (input: Input) => string,
    private readonly batchLoad: (
      inputs: Input[],
    ) => Promise<(Output | undefined)[]>,
  ) {}

  load(input: Input): Promise<Output | undefined> {
    if (this.failure !== undefined) return Promise.reject(this.failure.error);
    const key = this.key(input);
    let result = this.cache.get(key);
    if (result === undefined) {
      result = new Promise((resolve, reject) => {
        this.pending.set(key, { input, resolve, reject });
        if (!this.flushScheduled) {
          this.flushScheduled = true;
          // Facades reach IO across many microtasks. Gather at the macrotask
          // boundary so FK and property resolution can join the same batch.
          setImmediate(() => void this.flush());
        }
      });
      this.cache.set(key, result);
    }
    return result;
  }

  private async flush(): Promise<void> {
    // Keep the scheduler occupied until the active batch finishes, so later
    // arrivals coalesce without overlapping gateway requests.
    while (this.pending.size > 0) {
      const batch = [...this.pending.values()];
      this.pending.clear();
      try {
        const values = await this.batchLoad(batch.map(({ input }) => input));
        batch.forEach((request, index) => request.resolve(values[index]));
      } catch (error) {
        this.failure = { error };
        for (const request of [...batch, ...this.pending.values()])
          request.reject(error);
        this.pending.clear();
        break;
      }
    }
    this.flushScheduled = false;
  }
}
