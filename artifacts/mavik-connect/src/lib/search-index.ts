// On-device message search.
//
// Why local-only: message content is end-to-end encrypted (see
// src/lib/crypto.ts) — the server only ever holds ciphertext, so it
// literally cannot offer search. The only place plaintext ever exists is
// in each user's own browser, after decryption. So search has to be local
// too: as DmThread.tsx/ChatRoom.tsx decrypt messages for display, they
// also feed the plaintext here. Searching only ever covers messages this
// device has actually opened/decrypted at some point — a brand new device
// (or one restored via a recovery phrase, see RecoveryPhraseModal) starts
// with an empty index and it fills back in as threads are revisited.
const DB_NAME = "mavik-search-index";
const DB_VERSION = 1;
const STORE_NAME = "messages";

export interface IndexedMessage {
  /** `${kind}:${messageId}` — globally unique even though DM/group message ids aren't namespaced against each other. */
  key: string;
  kind: "dm" | "group";
  /** threadId for a DM, groupId for a group. */
  targetId: string;
  targetName: string;
  messageId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Upserts one decrypted message into the local index. Call as messages are decrypted; safe to call repeatedly for the same message. */
export async function indexMessage(entry: IndexedMessage): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** Removes a message from the index — call when a message is deleted. */
export async function removeIndexedMessage(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Case-insensitive substring search across every locally-indexed message,
 * most recent first. A full scan is fine here — even an active chat
 * history rarely gets large enough for this to be perceptibly slow, and
 * it avoids the complexity of a real inverted index for what's a
 * personal, on-device dataset.
 */
export async function searchMessages(
  query: string,
  limit = 50,
): Promise<IndexedMessage[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const db = await openDb();
  const results: IndexedMessage[] = [];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const entry = cursor.value as IndexedMessage;
      if (
        entry.content.toLowerCase().includes(trimmed) ||
        entry.senderName.toLowerCase().includes(trimmed)
      ) {
        results.push(entry);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });

  return results
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Wipes all locally-indexed plaintext — offered in Settings for anyone who wants this device to forget searchable history without deleting the messages themselves. */
export async function clearSearchIndex(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
