// Offline compose queue. A message is already fully E2E-encrypted client
// side by the time handleSend calls this (see DmThread.tsx/ChatRoom.tsx) —
// queuing it here is just "try to POST this exact ciphertext later,"
// nothing crypto-related has to happen again on flush.
//
// Two independent flush triggers, since neither alone is fully reliable:
//  - `window.addEventListener('online', ...)` — fires reliably while a tab
//    is open, but does nothing if the tab is closed/backgrounded when
//    connectivity returns.
//  - Background Sync (`registration.sync.register(...)`) — lets the
//    service worker attempt a flush even with no tab open, but isn't
//    supported everywhere (notably Safari/iOS as of this writing) and
//    isn't guaranteed to fire promptly. See sw.js for its handler.
// Together they cover the large majority of "typed a message on a flaky
// connection" cases without needing a more heavyweight sync protocol.
const DB_NAME = "mavik-outbox";
const DB_VERSION = 1;
const STORE_NAME = "pending";
const SYNC_TAG = "mavik-outbox-flush";

export interface OutboxItem {
  id: string;
  kind: "dm" | "group";
  /** threadId for a DM, groupId for a group message. */
  targetId: string;
  content: string;
  replyToId?: string | null;
  /** Group messages only. */
  mentionedUserIds?: string[];
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOutboxItem(
  item: Omit<OutboxItem, "id" | "createdAt">,
): Promise<OutboxItem> {
  const full: OutboxItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  // Best-effort: ask the SW to try flushing even if this tab closes.
  // Silently ignored where Background Sync isn't supported.
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as any)?.sync?.register(SYNC_TAG);
  } catch {
    // no-op — the online-event listener is the fallback for this case
  }

  return full;
}

export async function listOutboxItems(): Promise<OutboxItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as OutboxItem[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
