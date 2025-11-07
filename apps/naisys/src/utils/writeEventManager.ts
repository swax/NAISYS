import * as events from "events";

/**
 * Singleton manager for stdout write events.
 * This allows multiple components to listen to stdout writes without conflicting
 * when overriding process.stdout.write.
 */
class WriteEventManager {
  private static instance: WriteEventManager;
  private eventEmitter = new events.EventEmitter();
  private originalWrite: any;
  private isHooked = false;

  private constructor() {}

  static getInstance(): WriteEventManager {
    if (!WriteEventManager.instance) {
      WriteEventManager.instance = new WriteEventManager();
    }
    return WriteEventManager.instance;
  }

  /**
   * Hook into process.stdout.write to emit events.
   * This is safe to call multiple times - it will only hook once.
   */
  hookStdout() {
    if (this.isHooked) return;

    this.originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => {
      this.eventEmitter.emit("write", false, ...args);
      return this.originalWrite.apply(process.stdout, <any>args);
    };

    this.isHooked = true;
  }

  /**
   * Subscribe to write events.
   * @returns Unsubscribe function
   */
  onWrite(listener: (...args: any[]) => void): () => void {
    this.eventEmitter.on("write", listener);
    return () => this.eventEmitter.off("write", listener);
  }
}

export const writeEventManager = WriteEventManager.getInstance();
