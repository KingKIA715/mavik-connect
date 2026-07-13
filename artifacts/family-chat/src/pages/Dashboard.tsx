import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGroups,
  useGetRecentActivity,
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageCirclePlus, Users, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEncryption, createAndShareGroupKey, createAndShareDmKey } from "@/hooks/use-encryption";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: groups, isLoading: groupsLoading } = useListGroups();
  const { data: threads, isLoading: threadsLoading } = useListDmThreads();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
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

      // If nobody has generated a key for this thread yet, I'm the one
      // setting it up. If the other person already has one, their client
      // will share a copy with me the next time they open the thread.
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
    <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-10 bg-background">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Welcome Home</h1>
        <p className="text-muted-foreground mt-1">Catch up with your family groups and messages below.</p>
      </div>

      {/* Group Chats */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-xl font-serif font-semibold">Group Chats</h2>

          <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full shadow-sm">
                <MessageCirclePlus className="w-5 h-5 mr-2" />
                New Family Group
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
        </div>

        {groupsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : groups?.length === 0 ? (
          <Card className="bg-card/50 border-dashed text-center py-10">
            <CardContent>
              <p className="text-muted-foreground mb-4">You aren't in any groups yet.</p>
              <Button variant="outline" onClick={() => setIsGroupDialogOpen(true)}>Create your first group</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups?.map(group => (
              <Link key={group.id} href={`/app/groups/${group.id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full border-border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-serif text-lg flex items-center justify-between">
                      {group.name}
                      <span className="text-xs font-sans font-normal text-muted-foreground flex items-center bg-muted px-2 py-1 rounded-full">
                        <Users className="w-3 h-3 mr-1" />
                        {group.memberCount}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {group.lastMessagePreview ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 italic">
                        "{group.lastMessagePreview}"
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground/50">No messages yet.</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Direct Messages */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-xl font-serif font-semibold">Direct Messages</h2>

          <Dialog open={isDmDialogOpen} onOpenChange={setIsDmDialogOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full shadow-sm">
                <MessageCirclePlus className="w-5 h-5 mr-2" />
                New Message
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
        </div>

        {threadsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : threads?.length === 0 ? (
          <Card className="bg-card/50 border-dashed text-center py-10">
            <CardContent>
              <p className="text-muted-foreground mb-4">No conversations yet.</p>
              <Button variant="outline" onClick={() => setIsDmDialogOpen(true)}>Message someone</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {threads?.map((thread) => (
              <Link key={thread.id} href={`/app/dms/${thread.id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer border-border bg-card">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Avatar className="w-11 h-11 border shadow-sm flex-shrink-0">
                      {thread.otherUserAvatarUrl && <AvatarImage src={thread.otherUserAvatarUrl} />}
                      <AvatarFallback className="bg-secondary text-secondary-foreground">
                        {thread.otherUserName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-serif font-semibold truncate">{thread.otherUserName}</span>
                        {thread.lastMessageAt && (
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      {thread.lastMessagePreview ? (
                        <p className="text-sm text-muted-foreground truncate italic">"{thread.lastMessagePreview}"</p>
                      ) : (
                        <p className="text-sm text-muted-foreground/50">No messages yet.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent Activity (groups only — DMs don't have a cross-thread feed yet) */}
      <section className="space-y-6">
        <h2 className="text-xl font-serif font-semibold border-b border-border pb-2">Recent Activity</h2>
        {activityLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activity?.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">It's quiet around here...</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activity?.map((item, i) => (
              <Link key={i} href={`/app/groups/${item.groupId}`}>
                <div className="p-3 rounded-lg hover:bg-muted/50 transition-colors group border border-border bg-card">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium">{item.senderName}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-xs text-primary mb-1">{item.groupName}</p>
                  <p className="text-sm text-muted-foreground line-clamp-1">{item.content}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
