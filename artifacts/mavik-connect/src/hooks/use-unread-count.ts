import { useListGroups, useListDmThreads } from "@workspace/api-client-react";

/**
 * Total unread count across every group and DM thread. Both callers
 * (ChatListSidebar's Badging API effect, and the "Chats" nav item badge)
 * share the same underlying react-query cache/queryKey, so calling this
 * from multiple places doesn't cause extra network requests.
 */
export function useTotalUnreadCount(): number {
  const { data: groups } = useListGroups();
  const { data: threads } = useListDmThreads();

  return (
    (groups?.reduce((sum, g) => sum + (g.unreadCount || 0), 0) ?? 0) +
    (threads?.reduce((sum, t) => sum + (t.unreadCount || 0), 0) ?? 0)
  );
}
