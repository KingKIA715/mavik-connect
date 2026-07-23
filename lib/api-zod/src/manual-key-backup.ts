// Hand-authored to match the project's generated-schema conventions.
//
// This isn't run through orval/openapi.yaml (yet) — see the corresponding
// addition to lib/api-spec/openapi.yaml for the source-of-truth spec these
// mirror. If you regenerate the client, fold these into the generated
// output and delete this file.
import * as zod from "zod";

/**
 * Encrypted backup of the current user's E2E private key. `ciphertext` is
 * the PKCS8 private key, AES-GCM-encrypted with a key derived (PBKDF2) from
 * a recovery phrase that only ever exists on the client. `salt` and `iv`
 * are required to re-derive the same key and decrypt.
 */
export const SetMyKeyBackupBody = zod.object({
  ciphertext: zod.string().min(1),
  salt: zod.string().min(1),
  iv: zod.string().min(1),
});

export const GetMyKeyBackupResponse = zod.object({
  ciphertext: zod.string().nullable(),
  salt: zod.string().nullable(),
  iv: zod.string().nullable(),
});
