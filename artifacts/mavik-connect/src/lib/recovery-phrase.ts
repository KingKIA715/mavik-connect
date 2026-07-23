// A recovery phrase is the user's way out of "I lost this browser/device
// and no one else's browser holds my keys anymore" — see crypto.ts for how
// it plugs into key setup. It is never sent to the server; only the
// ciphertext it's used to produce is.
//
// This is a simplified word list, not the canonical BIP39 list — 128 short,
// unambiguous, easy-to-write-down English words. A 12-word phrase from this
// list carries ~84 bits of entropy (log2(128) * 12), which combined with a
// slow PBKDF2 derivation (see deriveWrappingKey) makes offline brute-force
// of a stolen backup blob impractical, without asking a family member to
// transcribe a 24-word cryptographic-grade phrase.
const WORDLIST = [
  "apple","arrow","autumn","banjo","basket","beacon","bicycle","blanket",
  "bramble","breeze","bridge","canyon","cabin","candle","canvas","cedar",
  "cellar","chalk","cherry","circle","clover","comet","copper","coral",
  "cotton","cradle","crane","crimson","crystal","dagger","daisy","dawn",
  "denim","desert","dolphin","dragon","drift","ember","falcon","feather",
  "fern","flame","flute","forest","fossil","garden","garnet","gazelle",
  "glacier","goblin","granite","gravel","harbor","harvest","hazel","heron",
  "hollow","honey","hunter","indigo","ivory","jacket","jasper","jungle",
  "kettle","kingdom","lagoon","lantern","laurel","lemon","linen","lotus",
  "maple","marble","meadow","meteor","mirror","mist","mitten","moss",
  "mountain","nectar","needle","nutmeg","oasis","oak","onyx","orbit",
  "otter","paddle","panther","parcel","pearl","pebble","pepper","piano",
  "pigeon","pillow","planet","plume","pocket","prairie","quartz","quill",
  "rabbit","raven","reef","ribbon","ridge","river","rocket","saddle",
  "sailor","satin","scarlet","shadow","shell","silver","sparrow","spruce",
  "storm","summit","sunset","swan","tangerine","thistle","thunder","tiger",
  "timber","topaz","tulip","tundra","valley","velvet","violet","willow",
];

export function generateRecoveryPhrase(wordCount = 12): string[] {
  const words: string[] = [];
  const randomValues = new Uint32Array(wordCount);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < wordCount; i++) {
    words.push(WORDLIST[randomValues[i] % WORDLIST.length]);
  }
  return words;
}

/** Normalizes user input (extra whitespace, casing) before deriving a key from it. */
export function normalizePhrase(phrase: string | string[]): string {
  const words = Array.isArray(phrase) ? phrase : phrase.split(/\s+/);
  return words
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
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

const PBKDF2_ITERATIONS = 600_000;

async function deriveWrappingKey(
  phrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizePhrase(phrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.slice().buffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedKeyBackup {
  ciphertext: string;
  salt: string;
  iv: string;
}

/**
 * Encrypts an exported (PKCS8) private key with a key derived from a
 * recovery phrase. The phrase itself is discarded after this call — only
 * the ciphertext/salt/iv are meant to be persisted (server-side, since a
 * local-only backup wouldn't survive the exact "lost this device" scenario
 * it exists for).
 */
export async function encryptPrivateKeyForBackup(
  privateKeyPkcs8: ArrayBuffer,
  phrase: string[],
): Promise<EncryptedKeyBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(phrase.join(" "), salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    privateKeyPkcs8,
  );
  return {
    ciphertext: bufToBase64(ciphertext),
    salt: bufToBase64(salt.buffer),
    iv: bufToBase64(iv.buffer),
  };
}

/**
 * Reverses encryptPrivateKeyForBackup, returning the raw PKCS8 bytes.
 * Throws (AES-GCM auth tag mismatch) if the phrase is wrong.
 */
export async function decryptPrivateKeyFromBackup(
  backup: EncryptedKeyBackup,
  phrase: string,
): Promise<ArrayBuffer> {
  const salt = new Uint8Array(base64ToBuf(backup.salt));
  const iv = new Uint8Array(base64ToBuf(backup.iv));
  const wrappingKey = await deriveWrappingKey(phrase, salt);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    base64ToBuf(backup.ciphertext),
  );
}
