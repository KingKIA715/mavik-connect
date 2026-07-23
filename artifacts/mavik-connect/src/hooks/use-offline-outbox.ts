import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  sendDmMessage,
  sendMessage,
  getListDmMessagesQueryKey,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import {
  listOutboxItems,
  removeOutboxItem,
  type OutboxItem,
} from "@/lib/outbox";

async function sendOutboxItem(item: OutboxItem): Promise<void> {
  if (item.kind === "dm") {
    await sendDmMessage(item.targetId, {
      content: item.content,
      replyToId: item.replyToId ?? undefined,
    });
  } else {
    await sendMessage(item.targetId, {
      content: item.content,
      replyToId: item.replyToId ?? undefined,
      mentionedUserIds: item.mentionedUserIds,
    });
  }
}

/**
 * Mounted once app-wide (see Layout.tsx). Flushes any queued offline
 * messages, in the order they were composed, whenever the app regains
 * connectivity — the online-event side of the two-pronged approach
 * described in outbox.ts (the other being Background Sync, handled by the
 * service worker for when no tab is open).
 */
export function useOfflineOutboxFlush() {
  const queryClient = useQueryClient();
  const isFlushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (isFlushingRef.current || !navigator.onLine) return;
    isFlushingRef.current = true;
    try {
      const items = await listOutboxItems();
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const touchedDmThreads = new Set<string>();
      const touchedGroups = new Set<string>();

      for (const item of items) {
        try {
          await sendOutboxItem(item);
          await removeOutboxItem(item.id);
          if (item.kind === "dm") touchedDmThreads.add(item.targetId);
          else touchedGroups.add(item.targetId);
        } catch {
          // Stop on the first failure (still offline, or a real server
          // error) rather than reordering by skipping ahead — leaves
          // this and everything after it queued for the next attempt.
          break;
        }
      }

      for (const threadId of touchedDmThreads) {
        queryClient.invalidateQueries({
          queryKey: getListDmMessagesQueryKey(threadId),
        });
      }
      for (const groupId of touchedGroups) {
        queryClient.invalidateQueries({
          queryKey: getListMessagesQueryKey(groupId),
        });
      }
    } finally {
      isFlushingRef.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    flush();
    window.addEventListener("online", flush);
    navigator.serviceWorker?.addEventListener?.("message", (event) => {
      if (event.data?.type === "mavik-outbox-flush-requested") flush();
    });
    return () => window.removeEventListener("online", flush);
  }, [flush]);
}
