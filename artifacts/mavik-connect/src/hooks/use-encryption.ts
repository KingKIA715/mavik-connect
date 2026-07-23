import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyProfile,
  useSetMyPublicKey,
  useGetMyGroupKey,
  useGetMyDmKey,
  getMyDmKey,
  setDmKey as setDmKeyApi,
  getMyKeyBackup,
  setMyKeyBackup,
  getGetMyGroupKeyQueryKey,
  getGetMyDmKeyQueryKey,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";
import {
  loadLocalIdentity,
  setupNewIdentity,
  restoreIdentityFromPhrase,
  generateGroupKey,
  unwrapGroupKey,
  wrapGroupKeyForMember,
} from "@/lib/crypto";
import type { EncryptedKeyBackup } from "@/lib/recovery-phrase";

const groupKeyCache = new Map<string, CryptoKey>();

export function getCachedGroupKey(groupId: string): CryptoKey | null {
  return groupKeyCache.get(groupId) ?? null;
}

function setCachedGroupKey(groupId: string, key: CryptoKey) {
  groupKeyCache.set(groupId, key);
}

type EncryptionIdentity = { privateKey: CryptoKey; publicKey: string } | null;

export type EncryptionStatus =
  | "loading"
  | "ready"
  // Server already has a public key for this account, but this browser
  // has no local private key and no way to derive one — the only path
  // forward is the recovery phrase (or another device re-sharing thread
  // keys to a freshly-generated one, which the user can also choose).
  | "needs-restore"
  // A brand-new identity was just generated. The recovery phrase is
  // shown exactly once here; the encrypted backup is already saved
  // server-side by the time this state is reached, so closing the app
  // without acknowledging doesn't lose the backup, just the user's own
  // copy of the phrase.
  | "needs-backup-ack";

interface EncryptionContextValue {
  status: EncryptionStatus;
  identity: EncryptionIdentity;
  /** Only populated in the "needs-backup-ack" state. */
  recoveryPhrase: string[] | null;
  /** Call after the user has saved their new recovery phrase somewhere. */
  acknowledgeBackup: () => void;
  /** Attempts to restore this account's identity from a recovery phrase. Throws on wrong phrase. */
  restoreFromPhrase: (phrase: string) => Promise<void>;
  /** Gives up trying to restore and starts a brand-new identity instead (old messages become unreadable on this device). */
  startFreshIdentity: () => Promise<void>;
}

const EncryptionContext = createContext<EncryptionContextValue>({
  status: "loading",
  identity: null,
  recoveryPhrase: null,
  acknowledgeBackup: () => {},
  restoreFromPhrase: async () => {},
  startFreshIdentity: async () => {},
});

/**
 * Ensures the signed-in user has an end-to-end encryption identity
 * (RSA keypair), stored as a non-extractable key in IndexedDB. Handles
 * three cases: identity already on this device (fast path), no identity
 * anywhere yet (generate + back up), and an existing account opened on a
 * device that doesn't have the identity locally (needs the recovery
 * phrase to restore rather than silently generating a new, incompatible
 * keypair).
 */
export function EncryptionProvider({ children }: { children: ReactNode }) {
  const { data: profile } = useGetMyProfile();
  const setPublicKey = useSetMyPublicKey();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<EncryptionStatus>("loading");
  const [identity, setIdentity] = useState<EncryptionIdentity>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[] | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    if (doneRef.current === profile.id || inFlightRef.current === profile.id)
      return;
    inFlightRef.current = profile.id;

    (async () => {
      const local = await loadLocalIdentity(profile.id);
      if (local) {
        // Migrated identities (old localStorage format) don't carry a
        // publicKey of their own — trust the server's copy, which is
        // untouched since the keypair itself didn't change.
        setIdentity({
          privateKey: local.privateKey,
          publicKey: local.publicKey || profile.publicKey || "",
        });
        setStatus("ready");
        doneRef.current = profile.id;
        return;
      }

      if (!profile.publicKey) {
        // True first-time setup for this account.
        const result = await setupNewIdentity(
          profile.id,
          async (publicKey) => {
            await setPublicKey.mutateAsync({ data: { publicKey } });
            queryClient.invalidateQueries({
              queryKey: getGetMyProfileQueryKey(),
            });
          },
          async (backup) => {
            await setMyKeyBackup(backup);
          },
        );
        setIdentity({ privateKey: result.privateKey, publicKey: result.publicKey });
        setRecoveryPhrase(result.recoveryPhrase);
        setStatus("needs-backup-ack");
        doneRef.current = profile.id;
        return;
      }

      // Account exists, has a public key on file, but this browser has
      // nothing locally — needs the recovery phrase.
      setStatus("needs-restore");
      doneRef.current = profile.id;
    })()
      .catch((err) => {
        console.error("Failed to set up encryption identity, will retry:", err);
      })
      .finally(() => {
        if (inFlightRef.current === profile.id) inFlightRef.current = null;
      });
  }, [profile?.id, profile?.publicKey, queryClient, setPublicKey]);

  const acknowledgeBackup = () => {
    setRecoveryPhrase(null);
    setStatus("ready");
  };

  const restoreFromPhrase = async (phrase: string) => {
    if (!profile?.id || !profile.publicKey) {
      throw new Error("No account/public key to restore against yet.");
    }
    const backupResponse = await getMyKeyBackup();
    if (!backupResponse.ciphertext || !backupResponse.salt || !backupResponse.iv) {
      throw new Error(
        "No backup was found on the server for this account — restoring isn't possible here.",
      );
    }
    const backup: EncryptedKeyBackup = {
      ciphertext: backupResponse.ciphertext,
      salt: backupResponse.salt,
      iv: backupResponse.iv,
    };
    const result = await restoreIdentityFromPhrase(
      profile.id,
      profile.publicKey,
      phrase,
      backup,
    );
    setIdentity(result);
    setStatus("ready");
  };

  const startFreshIdentity = async () => {
    if (!profile?.id) return;
    const result = await setupNewIdentity(
      profile.id,
      async (publicKey) => {
        await setPublicKey.mutateAsync({ data: { publicKey } });
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      },
      async (backup) => {
        await setMyKeyBackup(backup);
      },
    );
    setIdentity({ privateKey: result.privateKey, publicKey: result.publicKey });
    setRecoveryPhrase(result.recoveryPhrase);
    setStatus("needs-backup-ack");
  };

  return createElement(
    EncryptionContext.Provider,
    {
      value: {
        status,
        identity,
        recoveryPhrase,
        acknowledgeBackup,
        restoreFromPhrase,
        startFreshIdentity,
      },
    },
    children,
  );
}

/**
 * Returns the current user's full encryption state: identity (once
 * ready), status, and the actions needed to drive the recovery-phrase
 * backup/restore flow. See RecoveryPhraseModal, which is the UI for the
 * "needs-backup-ack" and "needs-restore" states.
 */
export function useEncryption() {
  return useContext(EncryptionContext);
}

/** Generates a brand-new group key and stores a wrapped copy for the creator. */
export async function createAndShareGroupKey(params: {
  groupId: string;
  myUserId: string;
  myPublicKey: string;
  setGroupKey: (args: {
    groupId: string;
    data: { userId: string; wrappedKey: string };
  }) => Promise<unknown>;
}): Promise<CryptoKey> {
  const key = await generateGroupKey();
  const wrapped = await wrapGroupKeyForMember(key, params.myPublicKey);
  await params.setGroupKey({
    groupId: params.groupId,
    data: { userId: params.myUserId, wrappedKey: wrapped },
  });
  setCachedGroupKey(params.groupId, key);
  return key;
}

/** Shares an already-decrypted group key with another member's public key. */
export async function shareGroupKeyWithMember(params: {
  groupId: string;
  groupKey: CryptoKey;
  memberUserId: string;
  memberPublicKey: string;
  setGroupKey: (args: {
    groupId: string;
    data: { userId: string; wrappedKey: string };
  }) => Promise<unknown>;
}): Promise<void> {
  const wrapped = await wrapGroupKeyForMember(
    params.groupKey,
    params.memberPublicKey,
  );
  await params.setGroupKey({
    groupId: params.groupId,
    data: { userId: params.memberUserId, wrappedKey: wrapped },
  });
}

export type GroupKeyStatus = "loading" | "ready" | "missing";

/**
 * Loads (and caches) the current user's decrypted copy of a group's
 * encryption key. "missing" means no one has shared it with this browser
 * yet (e.g. this device's public key was uploaded after the invite).
 */
export function useMyGroupKey(
  groupId: string | undefined,
  privateKey: CryptoKey | null,
) {
  const [groupKey, setGroupKey] = useState<CryptoKey | null>(() =>
    groupId ? getCachedGroupKey(groupId) : null,
  );
  const [status, setStatus] = useState<GroupKeyStatus>(
    groupKey ? "ready" : "loading",
  );

  const { data, isFetched, refetch } = useGetMyGroupKey(groupId ?? "", {
    query: {
      enabled: !!groupId && !!privateKey && !groupKey,
      queryKey: getGetMyGroupKeyQueryKey(groupId ?? ""),
    },
  });

  useEffect(() => {
    if (!groupId) return;
    const cached = getCachedGroupKey(groupId);
    if (cached) {
      setGroupKey(cached);
      setStatus("ready");
      return;
    }
    if (!privateKey || !isFetched) return;

    if (!data?.wrappedKey) {
      setStatus("missing");
      return;
    }

    unwrapGroupKey(data.wrappedKey, privateKey)
      .then((key) => {
        setCachedGroupKey(groupId, key);
        setGroupKey(key);
        setStatus("ready");
      })
      .catch(() => setStatus("missing"));
  }, [groupId, privateKey, data, isFetched]);

  // Called when a "group-key-ready" WS event tells us a key was just shared
  // for this group — re-fetches even though react-query already considers
  // the (previously "no key yet") query settled.
  const retry = () => {
    setStatus("loading");
    void refetch();
  };

  return { groupKey, status, retry };
}

// --- DM thread key exchange ---
//
// Same design as group keys above (a random AES-256-GCM key, wrapped once
// per participant with their RSA public key), just keyed by DM thread id
// instead of group id, and always exactly 2 participants instead of N.
// Reuses the same generic crypto primitives (generateGroupKey/wrapGroupKeyForMember/
// unwrapGroupKey work on any AES key regardless of what it's "for").

const dmKeyCache = new Map<string, CryptoKey>();

export function getCachedDmKey(threadId: string): CryptoKey | null {
  return dmKeyCache.get(threadId) ?? null;
}

function setCachedDmKey(threadId: string, key: CryptoKey) {
  dmKeyCache.set(threadId, key);
}

/** Generates a brand-new DM thread key and stores a wrapped copy for the creator. */
export async function createAndShareDmKey(params: {
  threadId: string;
  myUserId: string;
  myPublicKey: string;
  setDmKey: (args: {
    threadId: string;
    data: { userId: string; wrappedKey: string };
  }) => Promise<unknown>;
}): Promise<CryptoKey> {
  const key = await generateGroupKey();
  const wrapped = await wrapGroupKeyForMember(key, params.myPublicKey);
  await params.setDmKey({
    threadId: params.threadId,
    data: { userId: params.myUserId, wrappedKey: wrapped },
  });
  setCachedDmKey(params.threadId, key);
  return key;
}

/** Shares an already-decrypted DM key with the other participant's public key. */
export async function shareDmKeyWithParticipant(params: {
  threadId: string;
  dmKey: CryptoKey;
  participantUserId: string;
  participantPublicKey: string;
  setDmKey: (args: {
    threadId: string;
    data: { userId: string; wrappedKey: string };
  }) => Promise<unknown>;
}): Promise<void> {
  const wrapped = await wrapGroupKeyForMember(
    params.dmKey,
    params.participantPublicKey,
  );
  await params.setDmKey({
    threadId: params.threadId,
    data: { userId: params.participantUserId, wrappedKey: wrapped },
  });
}

/**
 * Best-effort self-heal for a DM thread where I already hold (or can
 * reconstruct) the decrypted key, but the other participant doesn't have a
 * wrapped copy on the server yet. Unlike shareDmKeyWithParticipant above
 * (which only runs while a specific thread's page happens to be open),
 * this uses plain fetch calls rather than hooks so it can run from
 * anywhere — see its caller in ChatListSidebar, which is mounted for as
 * long as the app is open, not just while a given conversation is on
 * screen. This is what lets a stuck "missing key" recipient (e.g. someone
 * who rejected a request and later decides to message back) get
 * unblocked without the other participant needing to happen to reopen
 * that exact conversation.
 *
 * Returns true if a key was (re)shared, false if there was nothing to do
 * (I don't hold a key for this thread myself either — nothing I can share).
 */
export async function reshareDmKeyIfMissing(params: {
  threadId: string;
  myPrivateKey: CryptoKey;
  otherUserId: string;
  otherUserPublicKey: string;
}): Promise<boolean> {
  let key = getCachedDmKey(params.threadId);
  if (!key) {
    const { wrappedKey } = await getMyDmKey(params.threadId);
    if (!wrappedKey) return false;
    key = await unwrapGroupKey(wrappedKey, params.myPrivateKey);
    setCachedDmKey(params.threadId, key);
  }
  const wrapped = await wrapGroupKeyForMember(key, params.otherUserPublicKey);
  await setDmKeyApi(params.threadId, {
    userId: params.otherUserId,
    wrappedKey: wrapped,
  });
  return true;
}

/**
 * Loads (and caches) the current user's decrypted copy of a DM thread's
 * encryption key. "missing" means no one has shared it with this browser
 * yet (e.g. the other participant set their public key after being invited).
 */
export function useMyDmKey(
  threadId: string | undefined,
  privateKey: CryptoKey | null,
) {
  const [dmKey, setDmKey] = useState<CryptoKey | null>(() =>
    threadId ? getCachedDmKey(threadId) : null,
  );
  const [status, setStatus] = useState<GroupKeyStatus>(
    dmKey ? "ready" : "loading",
  );

  const { data, isFetched, refetch } = useGetMyDmKey(threadId ?? "", {
    query: {
      enabled: !!threadId && !!privateKey && !dmKey,
      queryKey: getGetMyDmKeyQueryKey(threadId ?? ""),
    },
  });

  useEffect(() => {
    if (!threadId) return;
    const cached = getCachedDmKey(threadId);
    if (cached) {
      setDmKey(cached);
      setStatus("ready");
      return;
    }
    if (!privateKey || !isFetched) return;

    if (!data?.wrappedKey) {
      setStatus("missing");
      return;
    }

    unwrapGroupKey(data.wrappedKey, privateKey)
      .then((key) => {
        setCachedDmKey(threadId, key);
        setDmKey(key);
        setStatus("ready");
      })
      .catch(() => setStatus("missing"));
  }, [threadId, privateKey, data, isFetched]);

  // Called when a "dm-key-ready" WS event tells us a key was just shared for
  // this thread — re-fetches even though react-query already considers the
  // (previously "no key yet") query settled. This is what closes the loop on
  // the "new browser -> key rotation -> stuck on missing forever" bug.
  const retry = () => {
    setStatus("loading");
    void refetch();
  };

  return { dmKey, status, retry };
}
