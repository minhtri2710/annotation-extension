export interface ScreenshotStore {
  put(annotationId: string, blob: Blob): Promise<void>;
  get(annotationId: string): Promise<Blob | undefined>;
  delete(annotationIds: string[]): Promise<void>;
}

const DATABASE_NAME = 'annotation-extension-screenshots';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'screenshots';

/** Browser-only IndexedDB adapter; happy-dom does not provide IndexedDB. */
export function createScreenshotStore(): ScreenshotStore {
  return new IndexedDbScreenshotStore();
}

class IndexedDbScreenshotStore implements ScreenshotStore {
  async put(annotationId: string, blob: Blob): Promise<void> {
    const database = await openDatabase();
    await runTransaction(database, 'readwrite', (store) => {
      store.put(blob, annotationId);
    });
  }

  async get(annotationId: string): Promise<Blob | undefined> {
    const database = await openDatabase();
    return runTransaction<Blob | undefined>(database, 'readonly', (store) => store.get(annotationId));
  }

  async delete(annotationIds: string[]): Promise<void> {
    if (annotationIds.length === 0) return;
    const database = await openDatabase();
    await runTransaction(database, 'readwrite', (store) => {
      for (const annotationId of annotationIds) store.delete(annotationId);
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OBJECT_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Screenshot database could not be opened'));
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
    transaction.oncomplete = () => resolve(request?.result as T);
    transaction.onerror = () => reject(transaction.error ?? new Error('Screenshot transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Screenshot transaction aborted'));
  });
}
