import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetGroup, 
  useListMessages, 
  useSendMessage, 
  useAddGroupMember,
  useGetMyProfile,
  getListMessagesQueryKey,
  getGetGroupQueryKey
} from "@workspace/api-client-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Video, Send, UserPlus, Users } from "lucide-react";
import { format } from "date-fns";

export default function ChatRoom() {
  const { groupId } = useParams<{ groupId: string }>();
  const { data: profile } = useGetMyProfile();
  const { data: group, isLoading: groupLoading } = useGetGroup(groupId!, { query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId!) } });
  const { data: messages, isLoading: messagesLoading } = useListMessages(groupId!, { query: { enabled: !!groupId, queryKey: getListMessagesQueryKey(groupId!) } });
  
  const sendMessage = useSendMessage();
  const addMember = useAddGroupMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [content, setContent] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isConnected, onMessageRef } = useWebSocket(groupId);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle incoming WS messages
  useEffect(() => {
    onMessageRef.current = (msg) => {
      queryClient.setQueryData(getListMessagesQueryKey(groupId!), (old: any) => {
        if (!old) return [msg];
        if (old.find((m: any) => m.id === msg.id)) return old; // dedupe
        return [...old, msg];
      });
    };
  }, [groupId, queryClient, onMessageRef]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !groupId) return;

    sendMessage.mutate({ groupId, data: { content } }, {
      onSuccess: () => setContent("")
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !groupId) return;

    addMember.mutate({ groupId, data: { email: inviteEmail } }, {
      onSuccess: () => {
        toast({ title: "Member added successfully!" });
        setInviteEmail("");
        setIsInviteOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
      },
      onError: (err: any) => {
        toast({ 
          variant: "destructive",
          title: "Couldn't add member", 
          description: err.status === 404 ? "No account found for that email yet. Ask them to sign up first!" : "An error occurred."
        });
      }
    });
  };

  if (groupLoading) return <div className="p-10 flex-1 flex items-center justify-center">Loading...</div>;
  if (!group) return <div className="p-10">Group not found</div>;

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border bg-white px-6 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-4">
          <h2 className="font-serif text-xl font-bold text-foreground">{group.name}</h2>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
            <Users className="w-3.5 h-3.5" />
            {group.members.length} members
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <UserPlus className="w-5 h-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Invite a Family Member</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email Address</label>
                  <Input 
                    type="email" 
                    value={inviteEmail} 
                    onChange={e => setInviteEmail(e.target.value)} 
                    placeholder="mom@example.com" 
                  />
                  <p className="text-xs text-muted-foreground">They must have created an account first.</p>
                </div>
                <Button type="submit" disabled={addMember.isPending} className="w-full">
                  {addMember.isPending ? "Inviting..." : "Invite"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Link href={`/app/groups/${groupId}/call`}>
            <Button className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-2">
              <Video className="w-4 h-4" />
              Join Call
            </Button>
          </Link>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6">
          {messages?.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground italic font-serif">
              It's quiet here. Send the first message to {group.name}!
            </div>
          ) : (
            messages?.map((msg, idx) => {
              const isMe = msg.senderId === profile?.id;
              const showAvatar = !isMe && (idx === 0 || messages[idx - 1].senderId !== msg.senderId);
              
              return (
                <div key={msg.id} className={`flex gap-3 ${isMe ? 'justify-end' : 'justify-start'}`}>
                  {!isMe && (
                    <div className="w-8 flex-shrink-0">
                      {showAvatar && (
                        <Avatar className="w-8 h-8 border shadow-sm">
                          {msg.senderAvatarUrl && <AvatarImage src={msg.senderAvatarUrl} />}
                          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                            {msg.senderName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
                    {showAvatar && !isMe && (
                      <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">{msg.senderName}</span>
                    )}
                    <div className={`
                      px-4 py-2.5 rounded-2xl shadow-sm text-sm
                      ${isMe ? 
                        'bg-primary text-primary-foreground rounded-tr-sm' : 
                        'bg-white border border-border text-foreground rounded-tl-sm'
                      }
                    `}>
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 mt-1 px-1">
                      {format(new Date(msg.createdAt), "h:mm a")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="flex-none p-4 bg-white border-t border-border shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)]">
        <form onSubmit={handleSend} className="max-w-3xl mx-auto flex items-end gap-3 relative">
          <Input 
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-muted/30 border-muted-border rounded-full px-6 py-6 text-base shadow-inner focus-visible:ring-1"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!content.trim() || sendMessage.isPending}
            className="rounded-full w-12 h-12 shadow-md flex-shrink-0 absolute right-1 bottom-1"
          >
            <Send className="w-5 h-5 ml-1" />
          </Button>
        </form>
      </div>
    </div>
  );
}
