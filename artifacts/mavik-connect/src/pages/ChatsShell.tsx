import { useRoute } from "wouter";
import { Link } from "wouter";
import { useGetRecentActivity } from "@workspace/api-client-react";
import { ChatListSidebar } from "@/components/ChatListSidebar";
import ChatRoom from "@/pages/ChatRoom";
import DmThread from "@/pages/DmThread";
import { MessageCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function ChatsShell() {
  const [matchGroup, groupParams] = useRoute("/app/groups/:groupId");
  const [matchDm, dmParams] = useRoute("/app/dms/:threadId");

  const groupId = matchGroup ? groupParams?.groupId : undefined;
  const threadId = matchDm ? dmParams?.threadId : undefined;
  const hasSelection = !!groupId || !!threadId;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside
        className={`${hasSelection ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 flex-col border-r border-border bg-card flex-shrink-0 min-h-0`}
      >
        <ChatListSidebar activeGroupId={groupId} activeThreadId={threadId} />
      </aside>

      <main
        className={`${hasSelection ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0 min-h-0`}
      >
        {groupId ? <ChatRoom /> : threadId ? <DmThread /> : <EmptyState />}
      </main>
    </div>
  );
}

function EmptyState() {
  const { data: activity, isLoading } = useGetRecentActivity();

  return (
    <div className="flex-1 overflow-y-auto p-10 flex flex-col items-center">
      <div className="max-w-md text-center mt-10 mb-10">
        <MessageCircle className="w-14 h-14 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-serif font-bold text-foreground">
          Welcome Home
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
