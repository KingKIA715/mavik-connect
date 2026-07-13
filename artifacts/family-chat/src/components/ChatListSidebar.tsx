import { useState } from "react";
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
  getListDmThreadsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEncryption, createAndShareGroupKey, createAndShareDmKey } from "@/hooks/use-encryption";
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
  const { data: threads, isLoading: threadsLoading } = useListDmThreads();
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

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !identity) return;

    setIsCreatingGroup(true);
    try {
      const group = await createGroup.mutateAsync({ data: { name: newGroupName } });
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
      toast({ variant: "destructive", title: "Couldn't create group", description: "Please try again." });
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleStartConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmEmail.trim() || !identity || !profile) return;

    setIsStartingDm(true);
    try {
      const thread = await createDmThread.mutateAsync({ data: { email: dmEmail } });

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
      setIsDmDialogOpen(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't start conversation",
        description: err?.status === 404 ? "No account found for that email yet." : "Please try again.",
      });
    } finally {
      setIsStartingDm(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
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

        {tab === "groups" ? (
          <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="rounded-full flex-shrink-0" aria-label="New group">
                <Plus className="w-5 h-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Create a New Group</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateGroup} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-medium">Group Name</label>
                  <Input
                    id="name"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g., The Smiths, Sunday Dinners"
                    autoFocus
                  />
                </div>
                <Button type="submit" disabled={isCreatingGroup || !identity} className="w-full">
                  {isCreatingGroup ? "Creating..." : !identity ? "Setting up encryption..." : "Create Group"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        ) : (
          <Dialog open={isDmDialogOpen} onOpenChange={setIsDmDialogOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="rounded-full flex-shrink-0" aria-label="New message">
                <Plus className="w-5 h-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Start a Conversation</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleStartConversation} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <label htmlFor="dm-email" className="text-sm font-medium">Their Email</label>
                  <Input
                    id="dm-email"
                    type="email"
                    value={dmEmail}
                    onChange={(e) => setDmEmail(e.target.value)}
                    placeholder="mom@example.com"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">They must have created an account first.</p>
                </div>
                <Button type="submit" disabled={isStartingDm || !identity} className="w-full">
                  {isStartingDm ? "Starting..." : !identity ? "Setting up encryption..." : "Start Conversation"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {tab === "groups" ? (
          groupsLoading ? (
            <div className="p-2 space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />)}
            </div>
          ) : groups?.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No groups yet. Tap + to create one.
            </div>
          ) : (
            groups?.map(group => (
              <Link key={group.id} href={`/app/groups/${group.id}`}>
                <div className={`flex items-center gap-3 px-3 py-3 mx-1 my-0.5 rounded-lg cursor-pointer transition-colors ${activeGroupId === group.id ? "bg-secondary" : "hover:bg-muted/60"}`}>
                  <Avatar className="w-11 h-11 border shadow-sm flex-shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      <Users className="w-5 h-5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate text-sm">{group.name}</span>
                      {group.lastMessageAt && (
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(group.lastMessageAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {group.lastMessagePreview ?? "No messages yet."}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )
        ) : threadsLoading ? (
          <div className="p-2 space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />)}
          </div>
        ) : threads?.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No conversations yet. Tap + to message someone.
          </div>
        ) : (
          threads?.map(thread => (
            <Link key={thread.id} href={`/app/dms/${thread.id}`}>
              <div className={`flex items-center gap-3 px-3 py-3 mx-1 my-0.5 rounded-lg cursor-pointer transition-colors ${activeThreadId === thread.id ? "bg-secondary" : "hover:bg-muted/60"}`}>
                <Avatar className="w-11 h-11 border shadow-sm flex-shrink-0">
                  {thread.otherUserAvatarUrl && <AvatarImage src={thread.otherUserAvatarUrl} />}
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    {thread.otherUserName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate text-sm">{thread.otherUserName}</span>
                    {thread.lastMessageAt && (
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">
                        {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {thread.lastMessagePreview ?? "No messages yet."}
                  </p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
