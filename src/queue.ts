import path from 'path';
import fs from 'fs';

export class PersistentQueue<T = any> {
  private queue: T[];
  private persistenceFilePath: string;
  private saveInterval: number;
  private persistenceTimer: NodeJS.Timeout;

  constructor(persistenceFilePath: string, saveInterval = 5000) {
    this.persistenceFilePath = persistenceFilePath;
    this.saveInterval = saveInterval;
  }

  async init(): Promise<PersistentQueue<T>> {
    await this.loadQueue();
    this.startPersistence();
    return this;
  }

  enqueue(item: T): void {
    this.queue.push(item);
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  length(): number {
    return this.queue.length;
  }

  private async loadQueue(): Promise<void> {
    try {
      const data = fs.readFileSync(this.persistenceFilePath, 'utf8');
      this.queue = JSON.parse(data);
      if (!this.queue) this.queue = [];
    } catch (err) {
      const dirpath = path.dirname(this.persistenceFilePath);
      fs.mkdirSync(dirpath, { recursive: true });
      fs.writeFileSync(this.persistenceFilePath, '[]');
      this.queue = [];
    }
  }

  async saveQueue(): Promise<void> {
    try {
      fs.writeFileSync(this.persistenceFilePath, JSON.stringify(this.queue));
    } catch (err) {
      console.error('Error saving queue:', err);
    }
  }

  private startPersistence(): void {
    this.persistenceTimer = setInterval(async () => {
      try {
        await this.saveQueue();
      } catch (error) {
        console.error('Error during persistence:', error);
      }
    }, this.saveInterval);
  }

  async stopPersistence(): Promise<void> {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      await this.saveQueue();
    }
  }
}

export class ShutdownManager {
  private static queues: PersistentQueue<any>[] = [];

  static registerQueue(queue: PersistentQueue<any>): void {
    this.queues.push(queue);
  }

  static async shutdown(): Promise<void> {
    console.log('Shutting down...');
    for (const queue of this.queues) {
      await queue.stopPersistence();
    }
    console.log('All queues have been persisted. Exiting...');
    process.exit();
  }

  static setup(): void {
    process.on('SIGINT', this.shutdown.bind(this));
    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('uncaughtException', async (err) => {
      console.error('Uncaught exception:', err);
      await this.shutdown();
      process.exit(1);
    });
  }
}
