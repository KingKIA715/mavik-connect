import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDmThreads,
  useCreateDmThread,
  useSetDmKey,
  useGetMyProfile,
  getListDmThreadsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageCirclePlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEncryption, createAndShareDmKey } from "@/hooks/use-encryption";
import { useToast } from "@/hooks/use-toast";

export default function DmInbox() {
  const { data: threads, isLoading } = useListDmThreads();
  const { data: profile } = useGetMyProfile();
  const createDmThread = useCreateDmThread();
  const setDmKey = useSetDmKey();
  const queryClient = useQueryClient();
  const identity = useEncryption();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const handleStartConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !identity || !profile) return;

    setIsStarting(true);
    try {
      const thread = await createDmThread.mutateAsync({ data: { email } });

      // If nobody has generated a key for this thread yet, I'm the one
      // setting it up — generate one and keep a wrapped copy for myself.
      // If the other person already has one, their client will share a
      // copy with me automatically the next time they open this thread
      // (same pattern as inviting someone into a group).
      if (!thread.otherUserHasEncryptionKey) {
        await createAndShareDmKey({
          threadId: thread.id,
          myUserId: profile.id,
          myPublicKey: identity.publicKey,
          setDmKey: (args) => setDmKey.mutateAsync(args),
        });
      }

      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
      setEmail("");
      setIsDialogOpen(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't start conversation",
        description: err?.status === 404 ? "No account found for that email yet." : "Please try again.",
      });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 bg-background">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Direct Messages</h1>
          <p className="text-muted-foreground mt-1">Private conversations, just between the two of you.</p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mom@example.com"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">They must have created an account first.</p>
              </div>
              <Button type="submit" disabled={isStarting || !identity} className="w-full">
                {isStarting ? "Starting..." : !identity ? "Setting up encryption..." : "Start Conversation"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : threads?.length === 0 ? (
        <Card className="bg-card/50 border-dashed text-center py-10">
          <CardContent>
            <p className="text-muted-foreground mb-4">No conversations yet.</p>
            <Button variant="outline" onClick={() => setIsDialogOpen(true)}>Message someone</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 max-w-2xl">
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
    </div>
  );
}
