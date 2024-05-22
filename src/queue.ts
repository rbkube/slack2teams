const fs = require('fs').promises;

export class PersistentQueue<T> {
  private queue: T[];
  private persistenceFilePath: string;
  private saveInterval: number;
  private persistenceTimer: NodeJS.Timeout;

  constructor(init: T[], persistenceFilePath: string, saveInterval = 5000) {
    this.queue = init;
    this.persistenceFilePath = persistenceFilePath;
    this.saveInterval = saveInterval;
    this.loadQueue().then(() => {
      this.startPersistence();
    });
  }

  enqueue(item: T): void {
    this.queue.push(item);
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  private async loadQueue(): Promise<void> {
    try {
      const data = await fs.readFile(this.persistenceFilePath, 'utf8');
      this.queue = JSON.parse(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error loading queue:', err);
      }
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      await fs.writeFile(this.persistenceFilePath, JSON.stringify(this.queue, null, 2));
    } catch (err) {
      console.error('Error saving queue:', err);
    }
  }

  private startPersistence(): void {
    this.persistenceTimer = setInterval(async () => {
      await this.saveQueue();
    }, this.saveInterval);

    const shutdownHandler = async () => {
      await this.saveQueue();
      process.exit();
    };

    process.on('exit', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);
  }

  stopPersistence(): void {
    clearInterval(this.persistenceTimer);
  }
}
