import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGroups,
  useCreateGroup,
  useSetGroupKey,
  getListGroupsQueryKey,
  useListDmThreads,
  useCreateDmThread,
  useSetDmKey,
  useGetMyProfile,
  useSearchUsersByName,
  getSearchUsersByNameQueryKey,
  getListDmThreadsQueryKey,
} from "@workspace/api-client-react";
import type { SearchUserResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Users, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useEncryption,
  createAndShareGroupKey,
  createAndShareDmKey,
} from "@/hooks/use-encryption";
import { useToast } from "@/hooks/use-toast";

type Tab = "groups" | "dms";

export function ChatListSidebar({
  activeGroupId,
  activeThreadId,
}: {
  activeGroupId?: string;
  activeThreadId?: string;
}) {
  const [tab, setTab] = useState<Tab>(activeThreadId ? "dms" : "groups");

  const { data: groups, isLoading: groupsLoading } = useListGroups();
  const { data: threads, isLoading: threadsLoading } = useListDmThreads({
    query: {
      // There's no server push telling this browser "someone just started a
      // new conversation with you" — only actions the current user takes
      // themselves invalidate this list. Poll at a modest interval so a
      // brand-new incoming thread (e.g. from someone who deleted an old
      // rejected thread and started fresh) shows up within a bounded time
      // instead of requiring a manual reload.
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
      queryKey: getListDmThreadsQueryKey(),
    },
  });
  const { data: profile } = useGetMyProfile();
  const createGroup = useCreateGroup();
  const setGroupKey = useSetGroupKey();
  const createDmThread = useCreateDmThread();
  const setDmKey = useSetDmKey();
  const queryClient = useQueryClient();
  const identity = useEncryption();
  const { toast } = useToast();

  const [newGroupName, setNewGroupName] = useState("");
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const [dmEmail, setDmEmail] = useState("");
  const [isDmDialogOpen, setIsDmDialogOpen] = useState(false);
  const [isStartingDm, setIsStartingDm] = useState(false);

  // Name search for starting a new DM without knowing the exact email —
  // debounced so we're not firing a request on every keystroke.
  const [nameQuery, setNameQuery] = useState("");
  const [debouncedNameQuery, setDebouncedNameQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedNameQuery(nameQuery.trim()),
      300,
    );
    return () => clearTimeout(timer);
  }, [nameQuery]);
  const { data: nameResults, isFetching: isSearchingByName } =
    useSearchUsersByName(
      { name: debouncedNameQuery },
      {
        query: {
          enabled: debouncedNameQuery.length > 0,
          queryKey: getSearchUsersByNameQueryKey({ name: debouncedNameQuery }),
        },
      },
    );

  const startConversationWithEmail = async (email: string) => {
    if (!identity || !profile) return;
    setIsStartingDm(true);
    try {
      const thread = await createDmThread.mutateAsync({ data: { email } });

      if (!thread.otherUserHasEncryptionKey) {
        await createAndShareDmKey({
          threadId: thread.id,
          myUserId: profile.id,
          myPublicKey: identity.publicKey,
          setDmKey: (args) => setDmKey.mutateAsync(args),
        });
      }

      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
      setDmEmail("");
      setNameQuery("");
      setIsDmDialogOpen(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't start conversation",
        description:
          err?.status === 404
            ? "No account found for that email yet."
            : "Please try again.",
      });
    } finally {
      setIsStartingDm(false);
    }
  };

  const handleSelectSearchResult = (user: SearchUserResult) =>
    startConversationWithEmail(user.email);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !identity) return;

    setIsCreatingGroup(true);
    try {
      const group = await createGroup.mutateAsync({
        data: { name: newGroupName },
      });
      await createAndShareGroupKey({
        groupId: group.id,
        myUserId: group.createdBy,
        myPublicKey: identity.publicKey,
        setGroupKey: (args) => setGroupKey.mutateAsync(args),
      });
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      setNewGroupName("");
      setIsGroupDialogOpen(false);
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't create group",
        description: "Please try again.",
      });
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleStartConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmEmail.trim() || !identity || !profile) return;
    await startConversationWithEmail(dmEmail);
  };

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Category tabs */}
      <div className="flex-none flex items-center gap-1 p-2 border-b border-border">
        <button
          onClick={() => setTab("groups")}
          className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${tab === "groups" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          Groups
        </button>
        <button
          onClick={() => setTab("dms")}
          className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${tab === "dms" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          Direct Messages
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-20">
        {tab === "groups" ? (
          groupsLoading ? (
            <div className="p-2 space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 bg-muted/50 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : groups?.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No groups yet. Tap the + button to create one.
            </div>
          ) : (
            groups?.map((group) => {
              const isUnread = group.unreadCount > 0;
              return (
                <Link key={group.id} href={`/app/groups/${group.id}`}>
                  <div
                    className={`flex items-center gap-3 px-3 py-3 mx-1 my-0.5 rounded-lg cursor-pointer transition-colors ${activeGroupId === group.id ? "bg-secondary" : "hover:bg-muted/60"}`}
                  >
                    <Avatar className="w-11 h-11 border shadow-sm flex-shrink-0">
                      {group.avatarUrl && <AvatarImage src={group.avatarUrl} />}
                      <AvatarFallback className="bg-primary/10 text-primary">
                        <Users className="w-5 h-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-sm ${isUnread ? "font-semibold" : "font-medium"}`}
                        >
                          {group.name}
                        </span>
                        {group.lastMessageAt && (
                          <span
                            className={`text-[11px] flex-shrink-0 ${isUnread ? "text-primary font-medium" : "text-muted-foreground"}`}
                          >
                            {formatDistanceToNow(
                              new Date(group.lastMessageAt),
                              { addSuffix: true },
                            )}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`text-xs truncate ${isUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}
                        >
                          {group.lastMessagePreview ?? "No messages yet."}
                        </p>
                        {isUnread && (
                          <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                            {group.unreadCount > 99 ? "99+" : group.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )
        ) : threadsLoading ? (
          <div className="p-2 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-muted/50 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : threads?.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No conversations yet. Tap the + button to message someone.
          </div>
        ) : (
          threads?.map((thread) => {
            const isUnread = thread.unreadCount > 0;
            const isIncomingRequest =
              thread.status === "pending" && !thread.isInitiatedByMe;
            const isOutgoingRequest =
              thread.status === "pending" && thread.isInitiatedByMe;
            return (
              <Link key={thread.id} href={`/app/dms/${thread.id}`}>
                <div
                  className={`flex items-center gap-3 px-3 py-3 mx-1 my-0.5 rounded-lg cursor-pointer transition-colors ${activeThreadId === thread.id ? "bg-secondary" : "hover:bg-muted/60"}`}
                >
                  <Avatar className="w-11 h-11 border shadow-sm flex-shrink-0">
                    {thread.otherUserAvatarUrl && (
                      <AvatarImage src={thread.otherUserAvatarUrl} />
                    )}
                    <AvatarFallback className="bg-secondary text-secondary-foreground">
                      {thread.otherUserName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm flex items-center gap-1.5 ${isUnread ? "font-semibold" : "font-medium"}`}
                      >
                        {thread.otherUserName}
                        {isIncomingRequest && (
                          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-1.5 py-0.5">
                            Request
                          </span>
                        )}
                      </span>
                      {thread.lastMessageAt && (
                        <span
                          className={`text-[11px] flex-shrink-0 ${isUnread ? "text-primary font-medium" : "text-muted-foreground"}`}
                        >
                          {formatDistanceToNow(new Date(thread.lastMessageAt), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`text-xs truncate ${isUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}
                      >
                        {isIncomingRequest
                          ? "Wants to send you a message"
                          : isOutgoingRequest
                            ? "Message request sent · waiting for a reply"
                            : (thread.lastMessagePreview ?? "No messages yet.")}
                      </p>
                      {isUnread && (
                        <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                          {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Single floating action button — choose Group Chat or Direct Message */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="absolute bottom-5 right-5 w-14 h-14 rounded-full shadow-lg z-10"
            aria-label="Start a new chat"
          >
            <Plus className="w-6 h-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuItem onClick={() => setIsGroupDialogOpen(true)}>
            <Users className="w-4 h-4 mr-2" /> Group Chat
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsDmDialogOpen(true)}>
            <MessageCircle className="w-4 h-4 mr-2" /> Direct Message
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Create a New Group
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateGroup} className="space-y-4 pt-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Group Name
              </label>
              <Input
                id="name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g., The Smiths, Sunday Dinners"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={isCreatingGroup || !identity}
              className="w-full"
            >
              {isCreatingGroup
                ? "Creating..."
                : !identity
                  ? "Setting up encryption..."
                  : "Create Group"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDmDialogOpen} onOpenChange={setIsDmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Start a Conversation
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 pt-2">
            <label htmlFor="dm-name-search" className="text-sm font-medium">
              Find by name
            </label>
            <Input
              id="dm-name-search"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Search by name..."
              autoFocus
            />
            {debouncedNameQuery && (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {isSearchingByName ? (
                  <p className="text-sm text-muted-foreground px-3 py-2">
                    Searching...
                  </p>
                ) : nameResults && nameResults.length > 0 ? (
                  nameResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      disabled={isStartingDm}
                      onClick={() => handleSelectSearchResult(user)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 disabled:opacity-50"
                    >
                      <Avatar className="w-6 h-6">
                        {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                        <AvatarFallback className="text-xs">
                          {user.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{user.name}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground px-3 py-2">
                    No one found by that name.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
            <div className="flex-1 border-t" />
            or
            <div className="flex-1 border-t" />
          </div>

          <form onSubmit={handleStartConversation} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label htmlFor="dm-email" className="text-sm font-medium">
                Their Email
              </label>
              <Input
                id="dm-email"
                type="email"
                value={dmEmail}
                onChange={(e) => setDmEmail(e.target.value)}
                placeholder="mom@example.com"
              />
              <p className="text-xs text-muted-foreground">
                They must have created an account first.
              </p>
            </div>
            <Button
              type="submit"
              disabled={isStartingDm || !identity}
              className="w-full"
            >
              {isStartingDm
                ? "Starting..."
                : !identity
                  ? "Setting up encryption..."
                  : "Start Conversation"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
