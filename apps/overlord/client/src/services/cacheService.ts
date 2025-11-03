import { LogEntry, ThreadMessage } from "../lib/apiClient";

interface CacheData {
  logs: LogEntry[];
  mail: ThreadMessage[];
  lastLogId: number;
  lastMailId: number;
}

class CacheService {
  private dbName = "naisys-overlord-cache";
  private version = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains("logs")) {
          db.createObjectStore("logs", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("mail")) {
          db.createObjectStore("mail", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("metadata")) {
          db.createObjectStore("metadata", { keyPath: "key" });
        }
      };
    });
  }

  private ensureDb(): IDBDatabase {
    if (!this.db) {
      throw new Error("Database not initialized. Call init() first.");
    }
    return this.db;
  }

  async appendLogs(logs: LogEntry[]): Promise<void> {
    return this.appendItems(logs, "logs", "lastLogId");
  }

  async appendMail(mail: ThreadMessage[]): Promise<void> {
    return this.appendItems(mail, "mail", "lastMailId");
  }

  private async appendItems<T extends { id: number }>(
    items: T[],
    storeName: string,
    metadataKey: string,
  ): Promise<void> {
    if (items.length === 0) return;

    const transaction = this.ensureDb().transaction(
      [storeName, "metadata"],
      "readwrite",
    );
    const itemStore = transaction.objectStore(storeName);
    const metadataStore = transaction.objectStore("metadata");

    items.forEach((item) => itemStore.put(item));
    metadataStore.put({
      key: metadataKey,
      value: Math.max(...items.map((item) => item.id)),
    });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async loadCachedData(): Promise<CacheData> {
    const [logs, mail, lastLogId, lastMailId] = await Promise.all([
      this.getAllFromStore<LogEntry>("logs"),
      this.getAllFromStore<ThreadMessage>("mail"),
      this.getMetadata("lastLogId", -1),
      this.getMetadata("lastMailId", -1),
    ]);

    return {
      logs: logs.sort((a, b) => a.id - b.id),
      mail: mail.sort((a, b) => a.id - b.id),
      lastLogId,
      lastMailId,
    };
  }

  private async getAllFromStore<T>(storeName: string): Promise<T[]> {
    const db = this.ensureDb();
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  private async getMetadata(
    key: string,
    defaultValue: number,
  ): Promise<number> {
    const db = this.ensureDb();
    const transaction = db.transaction(["metadata"], "readonly");
    const store = transaction.objectStore("metadata");
    const request = store.get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : defaultValue);
      };
      request.onerror = () => reject(request.error);
    });
  }

  getLastLogId = () => this.getMetadata("lastLogId", -1);
  getLastMailId = () => this.getMetadata("lastMailId", -1);

  async clearCache(): Promise<void> {
    const stores = ["logs", "mail", "metadata"];
    const transaction = this.ensureDb().transaction(stores, "readwrite");

    stores.forEach((name) => transaction.objectStore(name).clear());

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export const cacheService = new CacheService();
