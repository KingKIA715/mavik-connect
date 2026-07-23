// Hand-authored to match orval's own output style (see generated/api.ts).
// Not run through codegen — see lib/api-spec/openapi.yaml for the source
// spec these mirror. Fold into generated output on the next codegen run.
import { customFetch } from "./custom-fetch";

export interface KeyBackupInput {
  ciphertext: string;
  salt: string;
  iv: string;
}

export interface KeyBackupResponse {
  ciphertext: string | null;
  salt: string | null;
  iv: string | null;
}

export const getMyKeyBackup = async (
  options?: RequestInit,
): Promise<KeyBackupResponse> => {
  return customFetch<KeyBackupResponse>("/users/me/key-backup", {
    ...options,
    method: "GET",
  });
};

export const setMyKeyBackup = async (
  data: KeyBackupInput,
  options?: RequestInit,
): Promise<{ ok: boolean }> => {
  return customFetch<{ ok: boolean }>("/users/me/key-backup", {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(data),
  });
};
