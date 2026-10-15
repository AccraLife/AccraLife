import type { SaveEnvelope } from './envelope';

/** Storage for save slots. IndexedDB in the browser, memory when it is unavailable (private mode). */
export interface SaveStore {
  get(slot: string): Promise<string | null>;
  put(slot: string, text: string): Promise<void>;
  remove(slot: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function memoryStore(): SaveStore {
  const map = new Map<string, string>();
  return {
    get: async (s) => map.get(s) ?? null,
    put: async (s, t) => void map.set(s, t),
    remove: async (s) => void map.delete(s),
    keys: async () => [...map.keys()],
  };
}

export function indexedDbStore(name = 'accra-life', storeName = 'saves'): Promise<SaveStore> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(storeName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        new Promise((res, rej) => {
          const tx = db.transaction(storeName, mode);
          const req = fn(tx.objectStore(storeName));
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
      resolve({
        get: async (s) => ((await run('readonly', (st) => st.get(s))) as string | undefined) ?? null,
        put: async (s, t) => void (await run('readwrite', (st) => st.put(t, s))),
        remove: async (s) => void (await run('readwrite', (st) => st.delete(s))),
        keys: async () => (await run('readonly', (st) => st.getAllKeys())).map(String),
      });
    };
  });
}

export type { SaveEnvelope };
