export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  delete(keys: string[]): Promise<void>;
}

const DATABASE_NAME = 'annotation-extension-blobs';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'blobs';

/** Browser-only IndexedDB adapter; happy-dom does not provide IndexedDB. */
export function createBlobStore(): BlobStore {
  return new IndexedDbBlobStore();
}

export function screenshotKey(annotationId: string): string {
  return `screenshot:${annotationId}`;
}

export function attachmentKey(attachmentId: string): string {
  return `attachment:${attachmentId}`;
}

export function isBlobKey(value: unknown): value is string {
  return typeof value === 'string' && /^(?:screenshot|attachment):[^:]+$/.test(value);
}

class IndexedDbBlobStore implements BlobStore {
  async put(key: string, blob: Blob): Promise<void> {
    const database = await openDatabase();
    await runTransaction(database, 'readwrite', (store) => {
      store.put(blob, key);
    });
  }

  async get(key: string): Promise<Blob | undefined> {
    const database = await openDatabase();
    return runTransaction<Blob | undefined>(database, 'readonly', (store) => store.get(key));
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const database = await openDatabase();
    await runTransaction(database, 'readwrite', (store) => {
      for (const key of keys) store.delete(key);
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        request.result.createObjectStore(OBJECT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Blob database could not be opened'));
  });
}

function runTransaction<T = void>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, mode);
    const request = operation(transaction.objectStore(OBJECT_STORE_NAME));
    transaction.oncomplete = () => {
      database.close();
      resolve(request?.result as T);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Blob transaction failed'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Blob transaction aborted'));
    };
  });
}
