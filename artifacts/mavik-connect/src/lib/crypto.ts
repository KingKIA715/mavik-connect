// End-to-end encryption for Mavik Connect.
//
// Design: every user has an RSA-OAEP keypair. The private key never leaves
// the browser — stored as a non-extractable CryptoKey in IndexedDB (see
// key-store.ts), not as plaintext in localStorage. Every group has a random
// AES-256-GCM key generated on the client. That AES key is "wrapped"
// (encrypted) once per member using that member's RSA public key, and only
// the wrapped copies are ever sent to the server — the server can never see
// a plaintext group key or plaintext message content.
//
// Identity recovery: a lost/cleared browser used to mean the private key
// was gone forever — fine for that one user's future messages (a new
// keypair works going forward), but catastrophic if EVERY participant in a
// thread eventually loses their browser, since the wrapped thread key
// becomes unrecoverable by anyone. See recovery-phrase.ts: on first setup,
// the private key is also encrypted with a key derived from a recovery
// phrase and that ciphertext is stored server-side. Restoring from the
// phrase on a brand new device recovers the exact same keypair (not a
// rotation), so every previously-wrapped group/DM key stays valid.

import {
  getStoredIdentity,
  setStoredIdentity,
  migrateFromLocalStorage,
} from "./key-store";
import {
  generateRecoveryPhrase,
  encryptPrivateKeyForBackup,
  decryptPrivateKeyFromBackup,
  normalizePhrase,
  type EncryptedKeyBackup,
} from "./recovery-phrase";

const RSA_ALGO = { name: "RSA-OAEP", hash: "SHA-256" };
const AES_ALGO = { name: "AES-GCM", length: 256 };

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ ...RSA_ALGO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "wrapKey",
    "unwrapKey",
  ]);
}

async function exportPublicKeyBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("spki", key);
  return bufToBase64(raw);
}

async function importPublicKeyBase64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", base64ToBuf(b64), RSA_ALGO, true, ["wrapKey"]);
}

/**
 * Step 1 of loading an identity: check for a key already stored on this
 * device (IndexedDB, or a one-time migration from the old localStorage
 * format). Never generates or restores anything — a null result means the
 * caller has to decide between setupNewIdentity (truly first-ever setup)
 * and restoreIdentityFromPhrase (this account exists, just not on this
 * device/browser).
 */
export async function loadLocalIdentity(
  userId: string,
): Promise<{ privateKey: CryptoKey; publicKey: string } | null> {
  const stored = await getStoredIdentity(userId);
  if (stored) return stored;

  const migrated = await migrateFromLocalStorage(userId);
  if (migrated) {
    // publicKey for a migrated identity is whatever the server already has
    // on file for this user — the keypair itself didn't change, so it's
    // filled in by the caller (which has the profile in hand) rather than
    // re-derived here.
    await setStoredIdentity(userId, { privateKey: migrated, publicKey: "" });
    return { privateKey: migrated, publicKey: "" };
  }

  return null;
}

/**
 * True first-time setup for this account (server has no public key on
 * file at all). Generates a fresh keypair, uploads the public half,
 * generates a recovery phrase, and immediately persists an encrypted
 * backup of the private key server-side via `saveBackup` — the phrase
 * itself is only ever shown to the user, never sent anywhere.
 */
export async function setupNewIdentity(
  userId: string,
  uploadPublicKey: (publicKey: string) => Promise<void>,
  saveBackup: (backup: EncryptedKeyBackup) => Promise<void>,
): Promise<{ privateKey: CryptoKey; publicKey: string; recoveryPhrase: string[] }> {
  const keyPair = await generateKeyPair();
  const publicKeyB64 = await exportPublicKeyBase64(keyPair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  const recoveryPhrase = generateRecoveryPhrase();
  const backup = await encryptPrivateKeyForBackup(pkcs8, recoveryPhrase);

  await uploadPublicKey(publicKeyB64);
  await saveBackup(backup);

  // Re-import as non-extractable for actual day-to-day use — the
  // extractable copy above only ever existed transiently to produce the
  // backup blob.
  const nonExtractablePrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    RSA_ALGO,
    false,
    ["unwrapKey"],
  );
  await setStoredIdentity(userId, {
    privateKey: nonExtractablePrivateKey,
    publicKey: publicKeyB64,
  });

  return { privateKey: nonExtractablePrivateKey, publicKey: publicKeyB64, recoveryPhrase };
}

/**
 * Restores an existing account's identity on a device/browser that doesn't
 * have it locally, using the recovery phrase against the server-stored
 * encrypted backup. Recovers the SAME keypair the server's publicKey
 * already corresponds to — this is a restore, not a rotation, so every
 * group/DM key already wrapped for this user elsewhere stays valid.
 * Throws if the phrase is wrong.
 */
export async function restoreIdentityFromPhrase(
  userId: string,
  publicKey: string,
  phrase: string,
  backup: EncryptedKeyBackup,
): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const pkcs8 = await decryptPrivateKeyFromBackup(backup, normalizePhrase(phrase));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    RSA_ALGO,
    false,
    ["unwrapKey"],
  );
  await setStoredIdentity(userId, { privateKey, publicKey });
  return { privateKey, publicKey };
}

export async function generateGroupKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(AES_ALGO, true, ["encrypt", "decrypt"]);
}

export async function wrapGroupKeyForMember(
  groupKey: CryptoKey,
  memberPublicKeyB64: string,
): Promise<string> {
  const publicKey = await importPublicKeyBase64(memberPublicKeyB64);
  const wrapped = await crypto.subtle.wrapKey("raw", groupKey, publicKey, RSA_ALGO);
  return bufToBase64(wrapped);
}

export async function unwrapGroupKey(
  wrappedKeyB64: string,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    base64ToBuf(wrappedKeyB64),
    privateKey,
    RSA_ALGO,
    AES_ALGO,
    true,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts plaintext with the group's AES key. Output is safe to store/send as-is. */
export async function encryptMessage(groupKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, groupKey, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `enc:${bufToBase64(combined.buffer)}`;
}

export function isEncryptedPayload(content: string): boolean {
  return content.startsWith("enc:");
}

/** Decrypts a payload produced by encryptMessage. Throws if the key is wrong/missing. */
export async function decryptMessage(groupKey: CryptoKey, payload: string): Promise<string> {
  const raw = new Uint8Array(base64ToBuf(payload.slice(4)));
  const iv = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, groupKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypts a File/Blob with the group's AES key for storage as message
 * content. The file's raw bytes are base64-encoded first, then run through
 * the same encryptMessage() pipeline used for text — so the server-side
 * schema and route never need to know the difference between a text message
 * and a file message; both are just an "enc:..." string in `content`.
 */
export async function encryptFile(groupKey: CryptoKey, file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const base64 = bufToBase64(buf);
  return encryptMessage(groupKey, base64);
}

/**
 * Reverses encryptFile: decrypts the payload back to the original base64
 * string, decodes it to raw bytes, and wraps it in a Blob with the given
 * mime type so it can be previewed or downloaded.
 */
export async function decryptFile(
  groupKey: CryptoKey,
  payload: string,
  mimeType: string | null | undefined,
): Promise<Blob> {
  const base64 = await decryptMessage(groupKey, payload);
  const buf = base64ToBuf(base64);
  return new Blob([buf], { type: mimeType || "application/octet-stream" });
}
