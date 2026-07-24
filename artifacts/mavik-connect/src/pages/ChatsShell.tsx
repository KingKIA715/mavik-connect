import { useRoute } from "wouter";
import { Link } from "wouter";
import { useRef } from "react";
import {
  useGetRecentActivity,
  useListGroups,
  useListDmThreads,
} from "@workspace/api-client-react";
import { ChatListSidebar, type ChatListSidebarHandle } from "@/components/ChatListSidebar";
import { Button } from "@/components/ui/button";
import ChatRoom from "@/pages/ChatRoom";
import DmThread from "@/pages/DmThread";
import { MessageCircle, Clock, Users, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function ChatsShell() {
  const [matchGroup, groupParams] = useRoute("/app/groups/:groupId");
  const [matchDm, dmParams] = useRoute("/app/dms/:threadId");
  const sidebarRef = useRef<ChatListSidebarHandle>(null);

  const groupId = matchGroup ? groupParams?.groupId : undefined;
  const threadId = matchDm ? dmParams?.threadId : undefined;
  const hasSelection = !!groupId || !!threadId;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside
        className={`${hasSelection ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 flex-col border-r border-border bg-card flex-shrink-0 min-h-0`}
      >
        <ChatListSidebar
          ref={sidebarRef}
          activeGroupId={groupId}
          activeThreadId={threadId}
        />
      </aside>

      <main
        className={`${hasSelection ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0 min-h-0`}
      >
        {groupId ? (
          <ChatRoom />
        ) : threadId ? (
          <DmThread />
        ) : (
          <EmptyState
            onCreateGroup={() => sidebarRef.current?.openCreateGroup()}
            onStartDm={() => sidebarRef.current?.openStartDm()}
          />
        )}
      </main>
    </div>
  );
}

function EmptyState({
  onCreateGroup,
  onStartDm,
}: {
  onCreateGroup: () => void;
  onStartDm: () => void;
}) {
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const { data: groups, isLoading: groupsLoading } = useListGroups();
  const { data: threads, isLoading: threadsLoading } = useListDmThreads();

  const isLoading = activityLoading || groupsLoading || threadsLoading;
  const isTrulyNew =
    !isLoading &&
    (groups?.length ?? 0) === 0 &&
    (threads?.length ?? 0) === 0;

  // A brand-new account has nothing to "pick from the left" — show a
  // real getting-started screen with working actions instead of copy
  // that only makes sense once you already have conversations.
  if (isTrulyNew) {
    return (
      <div className="flex-1 overflow-y-auto p-10 flex flex-col items-center justify-center">
        <div className="max-w-sm text-center">
          <MessageCircle className="w-14 h-14 text-primary/40 mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-bold text-foreground">
            Welcome to Mavik Connect
          </h1>
          <p className="text-muted-foreground mt-1 mb-6">
            Nothing here yet — start a group or message someone to get going.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={onCreateGroup} className="gap-2">
              <Users className="w-4 h-4" />
              Create a group
            </Button>
            <Button onClick={onStartDm} variant="outline" className="gap-2">
              <UserPlus className="w-4 h-4" />
              Message someone
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-10 flex flex-col items-center">
      <div className="max-w-md text-center mt-10 mb-10">
        <MessageCircle className="w-14 h-14 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-serif font-bold text-foreground">
          Welcome Back
        </h1>
        <p className="text-muted-foreground mt-1">
          Pick a group or a conversation from the left to get started.
        </p>
      </div>

      {!isLoading && activity && activity.length > 0 && (
        <div className="w-full max-w-md space-y-4 text-left">
          <h2 className="text-sm font-serif font-semibold text-muted-foreground uppercase tracking-wide">
            Recent Activity
          </h2>
          <div className="space-y-2">
            {activity.map((item, i) => (
              <Link key={i} href={`/app/groups/${item.groupId}`}>
                <div className="p-3 rounded-lg hover:bg-muted/50 transition-colors border border-border bg-card">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium">
                      {item.senderName}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(item.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-primary mb-1">{item.groupName}</p>
                  <p className="text-sm text-muted-foreground line-clamp-1">
                    {item.content}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
