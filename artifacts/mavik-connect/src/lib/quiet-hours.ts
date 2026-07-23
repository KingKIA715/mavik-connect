// Quiet hours suppress ordinary message push notifications during a
// time-of-day window (e.g. 9pm-7am) without muting a person or thread —
// see RecoveryPhraseModal-style pattern: settings live in IndexedDB rather
// than localStorage so the *service worker* (which handles push events,
// possibly with no app tab open) can read them too. Calls always ring
// through regardless — see sw.js, which checks payload.type === "call".
const DB_NAME = "mavik-settings";
const DB_VERSION = 1;
const STORE_NAME = "prefs";
const QUIET_HOURS_KEY = "quietHours";

export interface QuietHours {
  enabled: boolean;
  /** 0-23, local time. Wraps past midnight if startHour > endHour. */
  startHour: number;
  endHour: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startHour: 21,
  endHour: 7,
};

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

export async function getQuietHours(): Promise<QuietHours> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(QUIET_HOURS_KEY);
    req.onsuccess = () => resolve(req.result ?? DEFAULT_QUIET_HOURS);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function setQuietHours(value: QuietHours): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, QUIET_HOURS_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
