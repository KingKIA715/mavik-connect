import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyProfile,
  useSetMyPublicKey,
  useGetMyGroupKey,
  useGetMyDmKey,
  getGetMyGroupKeyQueryKey,
  getGetMyDmKeyQueryKey,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";
import { ensureKeyPair, generateGroupKey, unwrapGroupKey, wrapGroupKeyForMember } from "@/lib/crypto";

const groupKeyCache = new Map<string, CryptoKey>();

export function getCachedGroupKey(groupId: string): CryptoKey | null {
  return groupKeyCache.get(groupId) ?? null;
}

function setCachedGroupKey(groupId: string, key: CryptoKey) {
  groupKeyCache.set(groupId, key);
}

type EncryptionIdentity = { privateKey: CryptoKey; publicKey: string } | null;

const EncryptionContext = createContext<EncryptionIdentity>(null);

/**
 * Ensures the signed-in user has an end-to-end encryption identity
 * (RSA keypair). Generates + uploads one on first use per browser, and
 * provides it to descendants via context.
 */
export function EncryptionProvider({ children }: { children: ReactNode }) {
  const { data: profile } = useGetMyProfile();
  const setPublicKey = useSetMyPublicKey();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<EncryptionIdentity>(null);
  const inFlightRef = useRef<string | null>(null);
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    // Already set up (or currently setting up) for this exact profile snapshot — skip.
    if (doneRef.current === profile.id || inFlightRef.current === profile.id) return;
    inFlightRef.current = profile.id;

    ensureKeyPair(profile.id, profile.publicKey, async (publicKey) => {
      await setPublicKey.mutateAsync({ data: { publicKey } });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
    })
      .then((result) => {
        doneRef.current = profile.id;
        setIdentity(result);
      })
      .catch((err) => {
        console.error("Failed to set up encryption identity, will retry:", err);
      })
      .finally(() => {
        if (inFlightRef.current === profile.id) inFlightRef.current = null;
      });
  }, [profile?.id, profile?.publicKey, queryClient, setPublicKey]);

  return createElement(EncryptionContext.Provider, { value: identity }, children);
}

/** Returns the current user's encryption identity, or null while it's still being set up. */
export function useEncryption() {
  return useContext(EncryptionContext);
}

/** Generates a brand-new group key and stores a wrapped copy for the creator. */
export async function createAndShareGroupKey(params: {
  groupId: string;
  myUserId: string;
  myPublicKey: string;
  setGroupKey: (args: { groupId: string; data: { userId: string; wrappedKey: string } }) => Promise<unknown>;
}): Promise<CryptoKey> {
  const key = await generateGroupKey();
  const wrapped = await wrapGroupKeyForMember(key, params.myPublicKey);
  await params.setGroupKey({ groupId: params.groupId, data: { userId: params.myUserId, wrappedKey: wrapped } });
  setCachedGroupKey(params.groupId, key);
  return key;
}

/** Shares an already-decrypted group key with another member's public key. */
export async function shareGroupKeyWithMember(params: {
  groupId: string;
  groupKey: CryptoKey;
  memberUserId: string;
  memberPublicKey: string;
  setGroupKey: (args: { groupId: string; data: { userId: string; wrappedKey: string } }) => Promise<unknown>;
}): Promise<void> {
  const wrapped = await wrapGroupKeyForMember(params.groupKey, params.memberPublicKey);
  await params.setGroupKey({ groupId: params.groupId, data: { userId: params.memberUserId, wrappedKey: wrapped } });
}

export type GroupKeyStatus = "loading" | "ready" | "missing";

/**
 * Loads (and caches) the current user's decrypted copy of a group's
 * encryption key. "missing" means no one has shared it with this browser
 * yet (e.g. this device's public key was uploaded after the invite).
 */
export function useMyGroupKey(groupId: string | undefined, privateKey: CryptoKey | null) {
  const [groupKey, setGroupKey] = useState<CryptoKey | null>(() =>
    groupId ? getCachedGroupKey(groupId) : null,
  );
  const [status, setStatus] = useState<GroupKeyStatus>(groupKey ? "ready" : "loading");

  const { data, isFetched } = useGetMyGroupKey(groupId ?? "", {
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

  return { groupKey, status };
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
  setDmKey: (args: { threadId: string; data: { userId: string; wrappedKey: string } }) => Promise<unknown>;
}): Promise<CryptoKey> {
  const key = await generateGroupKey();
  const wrapped = await wrapGroupKeyForMember(key, params.myPublicKey);
  await params.setDmKey({ threadId: params.threadId, data: { userId: params.myUserId, wrappedKey: wrapped } });
  setCachedDmKey(params.threadId, key);
  return key;
}

/** Shares an already-decrypted DM key with the other participant's public key. */
export async function shareDmKeyWithParticipant(params: {
  threadId: string;
  dmKey: CryptoKey;
  participantUserId: string;
  participantPublicKey: string;
  setDmKey: (args: { threadId: string; data: { userId: string; wrappedKey: string } }) => Promise<unknown>;
}): Promise<void> {
  const wrapped = await wrapGroupKeyForMember(params.dmKey, params.participantPublicKey);
  await params.setDmKey({
    threadId: params.threadId,
    data: { userId: params.participantUserId, wrappedKey: wrapped },
  });
}

/**
 * Loads (and caches) the current user's decrypted copy of a DM thread's
 * encryption key. "missing" means no one has shared it with this browser
 * yet (e.g. the other participant set their public key after being invited).
 */
export function useMyDmKey(threadId: string | undefined, privateKey: CryptoKey | null) {
  const [dmKey, setDmKey] = useState<CryptoKey | null>(() =>
    threadId ? getCachedDmKey(threadId) : null,
  );
  const [status, setStatus] = useState<GroupKeyStatus>(dmKey ? "ready" : "loading");

  const { data, isFetched } = useGetMyDmKey(threadId ?? "", {
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

  return { dmKey, status };
}
