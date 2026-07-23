// IndexedDB-backed storage for the user's E2E identity key.
//
// Why not localStorage (the old approach): localStorage only ever holds
// strings, so a private key stored there has to be exportable — which
// means any successful XSS that can run `localStorage.getItem(...)` walks
// away with the raw key material. IndexedDB can store a CryptoKey object
// directly (structured clone), including one created with
// `extractable: false`. A non-extractable key can still be *used* (sign,
// unwrap, decrypt — whatever operations it was created for) but
// `crypto.subtle.exportKey()` on it always throws, in this tab or any
// other. That doesn't stop a compromised page from *using* the key while
// the user is on it, but it does stop the key itself from being exfiltrated
// wholesale — a meaningfully smaller blast radius.
const DB_NAME = "mavik-keystore";
const DB_VERSION = 1;
const STORE_NAME = "identity";

export interface StoredIdentity {
  privateKey: CryptoKey;
  publicKey: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getStoredIdentity(
  userId: string,
): Promise<StoredIdentity | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve((req.result as StoredIdentity) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function setStoredIdentity(
  userId: string,
  identity: StoredIdentity,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(identity, userId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStoredIdentity(userId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(userId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// One-time migration: pull a private key out of the old localStorage
// format (base64 PKCS8 string) so existing users don't get treated as
// "brand new device" and asked to restore from a phrase they were never
// shown. Imports it as non-extractable and deletes the plaintext copy.
export async function migrateFromLocalStorage(
  userId: string,
): Promise<CryptoKey | null> {
  const legacyKey = `familyChat:privateKey:${userId}`;
  const stored = localStorage.getItem(legacyKey);
  if (!stored) return null;

  const binary = atob(stored);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false, // non-extractable going forward
    ["unwrapKey"],
  );

  localStorage.removeItem(legacyKey);
  return privateKey;
}
