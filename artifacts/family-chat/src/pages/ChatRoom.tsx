import { useEffect, useState, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetGroup, 
  useListMessages, 
  useSendMessage, 
  useEditMessage,
  useDeleteMessage,
  useAddGroupMember,
  useDeleteGroup,
  useGetMyProfile,
  useSetGroupKey,
  useMarkGroupRead,
  getListMessagesQueryKey,
  getGetGroupQueryKey,
  getListGroupsQueryKey
} from "@workspace/api-client-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Video, Phone, Send, UserPlus, Users, Lock, ShieldAlert, Crown, Paperclip, Download, FileText, Check, CheckCheck } from "lucide-react";
import { format } from "date-fns";
import { useEncryption, useMyGroupKey, shareGroupKeyWithMember } from "@/hooks/use-encryption";
import { encryptMessage, decryptMessage, encryptFile, decryptFile, isEncryptedPayload } from "@/lib/crypto";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB — keep encrypted+base64 payload comfortably under the server's 15mb JSON limit

export default function ChatRoom() {
  const { groupId } = useParams<{ groupId: string }>();
  const [, navigate] = useLocation();
  const { data: profile } = useGetMyProfile();
  const { data: group, isLoading: groupLoading } = useGetGroup(groupId!, { query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId!) } });
  const { data: messages, isLoading: messagesLoading } = useListMessages(groupId!, undefined, { query: { enabled: !!groupId, queryKey: getListMessagesQueryKey(groupId!) } });
  
  const sendMessage = useSendMessage();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const addMember = useAddGroupMember();
  const deleteGroup = useDeleteGroup();
  const setGroupKey = useSetGroupKey();
  const markGroupRead = useMarkGroupRead();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const identity = useEncryption();
  const { groupKey, status: groupKeyStatus, retry: retryGroupKey } = useMyGroupKey(groupId, identity?.privateKey ?? null);

  const [content, setContent] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [isDeleteGroupConfirmOpen, setIsDeleteGroupConfirmOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { isConnected, onMessageRef, onMessageUpdateRef, onGroupDeletedRef, onReadRef, onGroupKeyReadyRef } = useWebSocket(groupId);

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

  // Handle incoming edits/deletes (a delete is just an update where
  // deletedAt gets set and content/attachment fields are cleared).
  useEffect(() => {
    onMessageUpdateRef.current = (msg) => {
      queryClient.setQueryData(getListMessagesQueryKey(groupId!), (old: any) => {
        if (!old) return old;
        return old.map((m: any) => (m.id === msg.id ? msg : m));
      });
    };
  }, [groupId, queryClient, onMessageUpdateRef]);

  // The creator deleted this group entirely — everyone currently viewing it
  // (including the creator's own other tabs) gets kicked back to the chat list.
  useEffect(() => {
    onGroupDeletedRef.current = () => {
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      toast({ title: "Group deleted", description: "This group no longer exists." });
      navigate("/app");
    };
  }, [queryClient, onGroupDeletedRef, toast, navigate]);

  // Live "Seen" updates: patch the affected member's lastReadAt directly in
  // the cached group data so the checkmark updates without a refetch.
  useEffect(() => {
    onReadRef.current = (userId, lastReadAt) => {
      queryClient.setQueryData(getGetGroupQueryKey(groupId!), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          members: old.members.map((m: any) =>
            m.userId === userId ? { ...m, lastReadAt } : m,
          ),
        };
      });
    };
  }, [groupId, queryClient, onReadRef]);

  // Closes the loop on the "new browser -> key rotation -> send disabled
  // forever" bug for groups, same fix as DmThread.tsx.
  useEffect(() => {
    onGroupKeyReadyRef.current = () => retryGroupKey();
  }, [onGroupKeyReadyRef, retryGroupKey]);

  // Mark the group read whenever we're looking at it and messages are
  // loaded. Also powers the sidebar's unread badge (same lastReadAt,
  // read server-side).
  useEffect(() => {
    if (!groupId || !messages || messages.length === 0) return;
    markGroupRead.mutate(
      { groupId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() }) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, messages?.length]);

  // Decrypt messages as they arrive/load, whenever we have the group key
  useEffect(() => {
    if (!groupKey || !messages) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const msg of messages) {
        if (!isEncryptedPayload(msg.content)) {
          next[msg.id] = msg.content;
          continue;
        }
        try {
          next[msg.id] = await decryptMessage(groupKey, msg.content);
        } catch {
          next[msg.id] = "";
        }
      }
      if (!cancelled) setDecrypted(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [groupKey, messages]);

  // Re-share the group key with any member who now has a public key but no
  // wrapped key yet (e.g. they just opened the app for the first time).
  useEffect(() => {
    if (!groupKey || !group || !groupId) return;
    for (const member of group.members) {
      if (!member.hasEncryptionKey && member.publicKey) {
        shareGroupKeyWithMember({
          groupId,
          groupKey,
          memberUserId: member.userId,
          memberPublicKey: member.publicKey,
          setGroupKey: (args) => setGroupKey.mutateAsync(args),
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, group, groupId]);

  // For file messages, turn the decrypted base64 payload into a Blob object
  // URL so it can be previewed (images) or downloaded. Revoke old URLs when
  // messages/groupKey change to avoid leaking memory.
  useEffect(() => {
    if (!groupKey || !messages) return;
    let cancelled = false;
    const createdUrls: string[] = [];

    (async () => {
      const next: Record<string, string> = {};
      for (const msg of messages) {
        if (msg.type !== "file" || !isEncryptedPayload(msg.content)) continue;
        try {
          const blob = await decryptFile(groupKey, msg.content, msg.mimeType);
          const url = URL.createObjectURL(blob);
          next[msg.id] = url;
          createdUrls.push(url);
        } catch {
          // leave missing — rendered as a broken/unavailable file below
        }
      }
      if (!cancelled) {
        setFileUrls(next);
      } else {
        createdUrls.forEach((u) => URL.revokeObjectURL(u));
      }
    })();

    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [groupKey, messages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow selecting the same file again later
    if (!file || !groupId || !groupKey) return;

    if (file.size > MAX_FILE_SIZE) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Please choose a file under ${Math.floor(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
      });
      return;
    }

    setIsUploading(true);
    try {
      const encrypted = await encryptFile(groupKey, file);
      await sendMessage.mutateAsync({
        groupId,
        data: {
          content: encrypted,
          type: "file",
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        },
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't send file", description: "An error occurred while uploading." });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !groupId || !groupKey) return;

    const encrypted = await encryptMessage(groupKey, content);
    sendMessage.mutate({ groupId, data: { content: encrypted } }, {
      onSuccess: () => setContent("")
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !groupId) return;

    addMember.mutate({ groupId, data: { email: inviteEmail } }, {
      onSuccess: async (invitee) => {
        toast({ title: "Member added successfully!" });
        setInviteEmail("");
        setIsInviteOpen(false);

        if (groupKey && invitee.publicKey) {
          await shareGroupKeyWithMember({
            groupId,
            groupKey,
            memberUserId: invitee.userId,
            memberPublicKey: invitee.publicKey,
            setGroupKey: (args) => setGroupKey.mutateAsync(args),
          });
        }

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

  const handleSaveEdit = async (e: React.FormEvent, messageId: string) => {
    e.preventDefault();
    if (!editDraft.trim() || !groupId || !groupKey) return;

    const encrypted = await encryptMessage(groupKey, editDraft);
    try {
      await editMessage.mutateAsync({ groupId, messageId, data: { content: encrypted } });
      setEditingMessageId(null);
    } catch {
      toast({ variant: "destructive", title: "Couldn't save edit", description: "Please try again." });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingMessageId || !groupId) return;
    try {
      await deleteMessage.mutateAsync({ groupId, messageId: deletingMessageId });
    } catch {
      toast({ variant: "destructive", title: "Couldn't delete message", description: "Please try again." });
    } finally {
      setDeletingMessageId(null);
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!groupId) return;
    try {
      await deleteGroup.mutateAsync({ groupId });
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      navigate("/app");
    } catch {
      toast({ variant: "destructive", title: "Couldn't delete group", description: "Please try again." });
    } finally {
      setIsDeleteGroupConfirmOpen(false);
    }
  };

  if (groupLoading) return <div className="p-10 flex-1 flex items-center justify-center">Loading...</div>;
  if (!group) return <div className="p-10">Group not found</div>;

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border bg-white px-3 sm:px-6 flex items-center justify-between shadow-sm z-10 gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link href="/app" className="md:hidden flex-shrink-0">
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back to chats">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h2 className="font-serif text-lg sm:text-xl font-bold text-foreground truncate max-w-[40vw] sm:max-w-none">{group.name}</h2>
          <Dialog open={isMembersOpen} onOpenChange={setIsMembersOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/70 transition-colors px-2.5 py-1 rounded-full flex-shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{group.members.length} members</span>
                <span className="sm:hidden">{group.members.length}</span>
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Family Members</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2 max-h-96 overflow-y-auto">
                {group.members.map((member) => (
                  <div key={member.userId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                    <Avatar className="w-10 h-10 border shadow-sm flex-shrink-0">
                      {member.avatarUrl && <AvatarImage src={member.avatarUrl} />}
                      <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
                        {member.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{member.name}</span>
                        {member.role === "owner" && (
                          <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                    {member.hasEncryptionKey ? (
                      <div className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full flex-shrink-0">
                        <Lock className="w-3 h-3" />
                        Encrypted
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full flex-shrink-0">
                        <ShieldAlert className="w-3 h-3" />
                        Pending
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => {
                  setIsMembersOpen(false);
                  setIsInviteOpen(true);
                }}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Someone New
              </Button>
              {group.createdBy === profile?.id && (
                <Button
                  variant="outline"
                  className="w-full mt-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setIsMembersOpen(false);
                    setIsDeleteGroupConfirmOpen(true);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Group
                </Button>
              )}
            </DialogContent>
          </Dialog>
          {groupKeyStatus === "ready" && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <Lock className="w-3.5 h-3.5" />
              Encrypted
            </div>
          )}
          {groupKeyStatus === "missing" && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
              <ShieldAlert className="w-3.5 h-3.5" />
              Waiting for access
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="rounded-full gap-1.5 text-muted-foreground px-2.5 sm:px-3">
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Invite</span>
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

          <Link href={`/app/groups/${groupId}/call?mode=voice`}>
            <Button variant="outline" className="rounded-full gap-2 px-2.5 sm:px-4" aria-label="Voice call">
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">Voice Call</span>
            </Button>
          </Link>

          <Link href={`/app/groups/${groupId}/call`}>
            <Button className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-2 px-2.5 sm:px-4" aria-label="Video call">
              <Video className="w-4 h-4" />
              <span className="hidden sm:inline">Join Call</span>
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
              const isLastMine = isMe && !messages.slice(idx + 1).some((m) => m.senderId === profile?.id);
              const otherMembers = group.members.filter((m) => m.userId !== profile?.id);
              const isSeen =
                isLastMine &&
                otherMembers.length > 0 &&
                otherMembers.every(
                  (m) => m.lastReadAt && new Date(m.lastReadAt) >= new Date(msg.createdAt),
                );
              
              return (
                <div key={msg.id} className={`flex gap-2 group ${isMe ? 'justify-end' : 'justify-start'}`}>
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

                  {isMe && !msg.deletedAt && editingMessageId !== msg.id && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-end pb-6">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="w-7 h-7 rounded-full text-muted-foreground" aria-label="Message actions">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {msg.type === "text" && (
                            <DropdownMenuItem onClick={() => { setEditingMessageId(msg.id); setEditDraft(decrypted[msg.id] ?? ""); }}>
                              <Pencil className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeletingMessageId(msg.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
                    {showAvatar && !isMe && (
                      <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">{msg.senderName}</span>
                    )}
                    {msg.deletedAt ? (
                      <div className="px-4 py-2.5 rounded-2xl text-sm italic text-muted-foreground bg-muted/50 border border-border">
                        This message was deleted
                      </div>
                    ) : msg.type === "file" ? (
                      <FileBubble
                        isMe={isMe}
                        fileName={msg.fileName}
                        mimeType={msg.mimeType}
                        fileSize={msg.fileSize}
                        url={fileUrls[msg.id]}
                        ready={!!decrypted[msg.id] || !isEncryptedPayload(msg.content)}
                      />
                    ) : editingMessageId === msg.id ? (
                      <form onSubmit={(e) => handleSaveEdit(e, msg.id)} className="flex flex-col gap-1.5 w-full min-w-[220px]">
                        <Input
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          autoFocus
                          className="text-sm"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditingMessageId(null)}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={!editDraft.trim() || editMessage.isPending}>
                            Save
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className={`
                        px-4 py-2.5 rounded-2xl shadow-sm text-sm
                        ${isMe ? 
                          'bg-primary text-primary-foreground rounded-tr-sm' : 
                          'bg-white border border-border text-foreground rounded-tl-sm'
                        }
                      `}>
                        {isEncryptedPayload(msg.content) ? (decrypted[msg.id] ?? "🔒 Decrypting…") : msg.content}
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 mt-1 px-1 flex items-center gap-1">
                      {format(new Date(msg.createdAt), "h:mm a")}
                      {msg.editedAt && !msg.deletedAt && <span>(edited)</span>}
                      {isLastMine && (
                        isSeen ? (
                          <span className="flex items-center gap-0.5 text-primary/70">
                            <CheckCheck className="w-3.5 h-3.5" /> Seen
                          </span>
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )
                      )}
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
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="rounded-full w-12 h-12 flex-shrink-0 text-muted-foreground"
            disabled={!groupKey || isUploading}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a file"
          >
            <Paperclip className="w-5 h-5" />
          </Button>
          <Input 
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={isUploading ? "Sending file…" : "Type a message..."}
            className="flex-1 bg-muted/30 border-muted-border rounded-full px-6 py-6 text-base shadow-inner focus-visible:ring-1"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!content.trim() || sendMessage.isPending || !groupKey}
            className="rounded-full w-12 h-12 shadow-md flex-shrink-0 absolute right-1 bottom-1"
          >
            <Send className="w-5 h-5 ml-1" />
          </Button>
        </form>
      </div>

      <AlertDialog open={!!deletingMessageId} onOpenChange={(open) => !open && setDeletingMessageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. The message (and its attachment, if any) will be replaced with "This message was deleted" for everyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteGroupConfirmOpen} onOpenChange={setIsDeleteGroupConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the group for everyone — all messages, members, and attachments will be gone. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FileBubble({
  isMe,
  fileName,
  mimeType,
  fileSize,
  url,
  ready,
}: {
  isMe: boolean;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  url?: string;
  ready: boolean;
}) {
  const isImage = !!mimeType?.startsWith("image/");
  const sizeLabel =
    fileSize != null
      ? fileSize < 1024 * 1024
        ? `${Math.max(1, Math.round(fileSize / 1024))} KB`
        : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
      : "";

  if (!ready || !url) {
    return (
      <div className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm flex items-center gap-2 ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-white border border-border text-foreground rounded-tl-sm'}`}>
        <FileText className="w-4 h-4" />
        {fileName ?? "File"} — 🔒 Decrypting…
      </div>
    );
  }

  if (isImage) {
    return (
      <a href={url} download={fileName ?? "image"} className="block rounded-2xl overflow-hidden shadow-sm border border-border max-w-xs">
        <img src={url} alt={fileName ?? "Shared image"} className="w-full h-auto object-cover" />
      </a>
    );
  }

  return (
    <a
      href={url}
      download={fileName ?? "file"}
      className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm flex items-center gap-3 hover:opacity-90 transition-opacity ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-white border border-border text-foreground rounded-tl-sm'}`}
    >
      <FileText className="w-5 h-5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="truncate font-medium">{fileName ?? "File"}</div>
        {sizeLabel && <div className="text-xs opacity-70">{sizeLabel}</div>}
      </div>
      <Download className="w-4 h-4 flex-shrink-0 ml-auto" />
    </a>
  );
}
