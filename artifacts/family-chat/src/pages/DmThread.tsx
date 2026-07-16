import { useEffect, useState, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDmThread,
  useListDmMessages,
  useSendDmMessage,
  useEditDmMessage,
  useDeleteDmMessage,
  useSetDmKey,
  useMarkDmThreadRead,
  useDeleteDmThread,
  useGetMyProfile,
  getListDmMessagesQueryKey,
  getGetDmThreadQueryKey,
  getListDmThreadsQueryKey,
} from "@workspace/api-client-react";
import { useThreadWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Lock, ShieldAlert, Paperclip, Download, FileText, Phone, Video, MoreVertical, Pencil, Trash2, Check, CheckCheck } from "lucide-react";
import { format } from "date-fns";
import {
  useEncryption,
  useMyDmKey,
  shareDmKeyWithParticipant,
} from "@/hooks/use-encryption";
import { encryptMessage, decryptMessage, encryptFile, decryptFile, isEncryptedPayload } from "@/lib/crypto";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB — see ChatRoom.tsx for why

export default function DmThread() {
  const { threadId } = useParams<{ threadId: string }>();
  const [, navigate] = useLocation();
  const { data: profile } = useGetMyProfile();
  const { data: thread, isLoading: threadLoading } = useGetDmThread(threadId!, {
    query: { enabled: !!threadId, queryKey: getGetDmThreadQueryKey(threadId!) },
  });
  const { data: messages, isLoading: messagesLoading } = useListDmMessages(threadId!, undefined, {
    query: { enabled: !!threadId, queryKey: getListDmMessagesQueryKey(threadId!) },
  });

  const sendDmMessage = useSendDmMessage();
  const editDmMessage = useEditDmMessage();
  const deleteDmMessage = useDeleteDmMessage();
  const setDmKey = useSetDmKey();
  const markThreadRead = useMarkDmThreadRead();
  const deleteDmThread = useDeleteDmThread();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const identity = useEncryption();
  const { dmKey, status: dmKeyStatus, retry: retryDmKey } = useMyDmKey(threadId, identity?.privateKey ?? null);

  const [content, setContent] = useState("");
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [isDeleteThreadConfirmOpen, setIsDeleteThreadConfirmOpen] = useState(false);
  // Read receipts: the other participant's last-read timestamp, seeded from
  // the thread fetch and kept live via the "read" WS event below so a
  // "Seen" checkmark appears on my last message without needing a reload.
  const [otherUserLastReadAt, setOtherUserLastReadAt] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onMessageRef, onMessageUpdateRef, onReadRef, onDmKeyReadyRef, onDmThreadDeletedRef } = useThreadWebSocket(threadId);

  useEffect(() => {
    if (thread) setOtherUserLastReadAt(thread.otherUserLastReadAt ?? null);
  }, [thread?.otherUserLastReadAt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    onMessageRef.current = (msg) => {
      queryClient.setQueryData(getListDmMessagesQueryKey(threadId!), (old: any) => {
        if (!old) return [msg];
        if (old.find((m: any) => m.id === msg.id)) return old;
        return [...old, msg];
      });
    };
  }, [threadId, queryClient, onMessageRef]);

  useEffect(() => {
    onMessageUpdateRef.current = (msg) => {
      queryClient.setQueryData(getListDmMessagesQueryKey(threadId!), (old: any) => {
        if (!old) return old;
        return old.map((m: any) => (m.id === msg.id ? msg : m));
      });
    };
  }, [threadId, queryClient, onMessageUpdateRef]);

  // Live "Seen" updates: when the other participant marks this thread read
  // (from their own device), update their last-read timestamp here without
  // needing a reload.
  useEffect(() => {
    onReadRef.current = (userId, lastReadAt) => {
      if (thread && userId === thread.otherUserId) {
        setOtherUserLastReadAt(lastReadAt);
      }
    };
  }, [thread, onReadRef]);

  // Closes the loop on the "new browser -> key rotation -> send disabled
  // forever" bug: the server tells us over WS as soon as a key becomes
  // available, so we re-fetch instead of waiting for a reload.
  useEffect(() => {
    onDmKeyReadyRef.current = () => retryDmKey();
  }, [onDmKeyReadyRef, retryDmKey]);

  // The other participant deleted this conversation entirely — leave the
  // page (mirrors ChatRoom.tsx's onGroupDeletedRef handling).
  useEffect(() => {
    onDmThreadDeletedRef.current = () => {
      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
      toast({ title: "Conversation deleted", description: "This conversation no longer exists." });
      navigate("/app");
    };
  }, [queryClient, onDmThreadDeletedRef, toast, navigate]);

  const handleConfirmDeleteThread = async () => {
    if (!threadId) return;
    try {
      await deleteDmThread.mutateAsync({ threadId });
      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
      navigate("/app");
    } catch {
      toast({ variant: "destructive", title: "Couldn't delete conversation", description: "Please try again." });
    } finally {
      setIsDeleteThreadConfirmOpen(false);
    }
  };

  // Mark the thread read whenever we're looking at it and messages are
  // loaded (covers first open and every new incoming message). Also powers
  // the sidebar's unread badge, which reads the same lastReadAt server-side.
  useEffect(() => {
    if (!threadId || !messages || messages.length === 0) return;
    markThreadRead.mutate(
      { threadId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() }) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, messages?.length]);

  // Decrypt messages as they arrive/load, whenever we have the thread key.
  useEffect(() => {
    if (!dmKey || !messages) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const msg of messages) {
        if (!isEncryptedPayload(msg.content)) {
          next[msg.id] = msg.content;
          continue;
        }
        try {
          next[msg.id] = await decryptMessage(dmKey, msg.content);
        } catch {
          next[msg.id] = "";
        }
      }
      if (!cancelled) setDecrypted(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [dmKey, messages]);

  // If I hold the thread key but the other participant doesn't have a
  // wrapped copy yet (e.g. they just set up their public key for the first
  // time), share it with them now — mirrors ChatRoom.tsx's re-share effect.
  useEffect(() => {
    if (!dmKey || !thread || !threadId) return;
    if (!thread.otherUserHasEncryptionKey && thread.otherUserPublicKey) {
      shareDmKeyWithParticipant({
        threadId,
        dmKey,
        participantUserId: thread.otherUserId,
        participantPublicKey: thread.otherUserPublicKey,
        setDmKey: (args) => setDmKey.mutateAsync(args),
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: getGetDmThreadQueryKey(threadId) });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmKey, thread, threadId]);

  // Turn decrypted file payloads into blob object URLs for preview/download.
  useEffect(() => {
    if (!dmKey || !messages) return;
    let cancelled = false;
    const createdUrls: string[] = [];

    (async () => {
      const next: Record<string, string> = {};
      for (const msg of messages) {
        if (msg.type !== "file" || !isEncryptedPayload(msg.content)) continue;
        try {
          const blob = await decryptFile(dmKey, msg.content, msg.mimeType);
          const url = URL.createObjectURL(blob);
          next[msg.id] = url;
          createdUrls.push(url);
        } catch {
          // leave missing — rendered as still-decrypting below
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
  }, [dmKey, messages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !threadId || !dmKey) return;

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
      const encrypted = await encryptFile(dmKey, file);
      await sendDmMessage.mutateAsync({
        threadId,
        data: {
          content: encrypted,
          type: "file",
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        },
      });
    } catch {
      toast({ variant: "destructive", title: "Couldn't send file", description: "An error occurred while uploading." });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !threadId || !dmKey) return;

    const encrypted = await encryptMessage(dmKey, content);
    sendDmMessage.mutate({ threadId, data: { content: encrypted } }, {
      onSuccess: () => setContent(""),
    });
  };

  const handleSaveEdit = async (e: React.FormEvent, messageId: string) => {
    e.preventDefault();
    if (!editDraft.trim() || !threadId || !dmKey) return;

    const encrypted = await encryptMessage(dmKey, editDraft);
    try {
      await editDmMessage.mutateAsync({ threadId, messageId, data: { content: encrypted } });
      setEditingMessageId(null);
    } catch {
      toast({ variant: "destructive", title: "Couldn't save edit", description: "Please try again." });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingMessageId || !threadId) return;
    try {
      await deleteDmMessage.mutateAsync({ threadId, messageId: deletingMessageId });
    } catch {
      toast({ variant: "destructive", title: "Couldn't delete message", description: "Please try again." });
    } finally {
      setDeletingMessageId(null);
    }
  };

  if (threadLoading) return <div className="p-10 flex-1 flex items-center justify-center">Loading...</div>;
  if (!thread) return <div className="p-10">Conversation not found</div>;

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border bg-white px-3 sm:px-6 flex items-center justify-between shadow-sm z-10 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/app" className="md:hidden flex-shrink-0">
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back to chats">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <Avatar className="w-9 h-9 border shadow-sm flex-shrink-0">
            {thread.otherUserAvatarUrl && <AvatarImage src={thread.otherUserAvatarUrl} />}
            <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
              {thread.otherUserName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h2 className="font-serif text-lg sm:text-xl font-bold text-foreground truncate max-w-[40vw] sm:max-w-none">
            {thread.otherUserName}
          </h2>

          {dmKeyStatus === "ready" && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <Lock className="w-3.5 h-3.5" />
              Encrypted
            </div>
          )}
          {dmKeyStatus === "missing" && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
              <ShieldAlert className="w-3.5 h-3.5" />
              Waiting for access
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href={`/app/dms/${threadId}/call?mode=voice`}>
            <Button variant="outline" className="rounded-full gap-2 px-2.5 sm:px-4" aria-label="Voice call">
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">Voice Call</span>
            </Button>
          </Link>

          <Link href={`/app/dms/${threadId}/call`}>
            <Button className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-2 px-2.5 sm:px-4" aria-label="Video call">
              <Video className="w-4 h-4" />
              <span className="hidden sm:inline">Join Call</span>
            </Button>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground" aria-label="Conversation actions">
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setIsDeleteThreadConfirmOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Delete Conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6">
          {messagesLoading ? null : messages?.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground italic font-serif">
              It's quiet here. Send the first message to {thread.otherUserName}!
            </div>
          ) : (
            messages?.map((msg, idx) => {
              const isMe = msg.senderId === profile?.id;
              const showAvatar = !isMe && (idx === 0 || messages[idx - 1].senderId !== msg.senderId);
              const isLastMine = isMe && !messages.slice(idx + 1).some((m) => m.senderId === profile?.id);
              const isSeen =
                isLastMine &&
                !!otherUserLastReadAt &&
                new Date(otherUserLastReadAt) >= new Date(msg.createdAt);

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
                          <Button type="submit" size="sm" disabled={!editDraft.trim() || editDmMessage.isPending}>
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
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="rounded-full w-12 h-12 flex-shrink-0 text-muted-foreground"
            disabled={!dmKey || isUploading}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a file"
          >
            <Paperclip className="w-5 h-5" />
          </Button>
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={isUploading ? "Sending file…" : !dmKey ? "Waiting for encryption access…" : "Type a message..."}
            className="flex-1 bg-muted/30 border-muted-border rounded-full px-6 py-6 text-base shadow-inner focus-visible:ring-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!content.trim() || sendDmMessage.isPending || !dmKey}
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
              This can't be undone. The message (and its attachment, if any) will be replaced with "This message was deleted" for both of you.
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

      <AlertDialog open={isDeleteThreadConfirmOpen} onOpenChange={setIsDeleteThreadConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Every message with {thread.otherUserName} will be permanently deleted for both of you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteThread} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Conversation
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
