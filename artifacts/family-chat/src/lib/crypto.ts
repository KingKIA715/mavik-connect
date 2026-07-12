// End-to-end encryption for Family Chat.
//
// Design: every user has an RSA-OAEP keypair. The private key never leaves
// the browser (stored in localStorage). Every group has a random AES-256-GCM
// key generated on the client. That AES key is "wrapped" (encrypted) once per
// member using that member's RSA public key, and only the wrapped copies are
// ever sent to the server — the server can never see a plaintext group key or
// plaintext message content.

const RSA_ALGO = { name: "RSA-OAEP", hash: "SHA-256" };
const AES_ALGO = { name: "AES-GCM", length: 256 };

function privateKeyStorageKey(userId: string) {
  return `familyChat:privateKey:${userId}`;
}

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

async function exportPrivateKeyBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("pkcs8", key);
  return bufToBase64(raw);
}

async function importPrivateKeyBase64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", base64ToBuf(b64), RSA_ALGO, true, ["unwrapKey"]);
}

/**
 * Ensures the current user has a local RSA keypair, generating one and
 * uploading the public half if this is the first time this browser has seen
 * this user. Returns the local private key (imported, ready to use).
 *
 * If a private key is already stored locally, the existing public key on the
 * server is left untouched so previously-wrapped group keys stay valid.
 */
export async function ensureKeyPair(
  userId: string,
  currentPublicKey: string | null | undefined,
  uploadPublicKey: (publicKey: string) => Promise<void>,
): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const stored = localStorage.getItem(privateKeyStorageKey(userId));
  if (stored) {
    return { privateKey: await importPrivateKeyBase64(stored), publicKey: currentPublicKey ?? "" };
  }

  const keyPair = await generateKeyPair();
  const privateKeyB64 = await exportPrivateKeyBase64(keyPair.privateKey);
  const publicKeyB64 = await exportPublicKeyBase64(keyPair.publicKey);

  localStorage.setItem(privateKeyStorageKey(userId), privateKeyB64);

  if (currentPublicKey !== publicKeyB64) {
    await uploadPublicKey(publicKeyB64);
  }

  return { privateKey: keyPair.privateKey, publicKey: publicKeyB64 };
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
