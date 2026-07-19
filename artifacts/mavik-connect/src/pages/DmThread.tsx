import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDmThread,
  useListDmMessages,
  useSendDmMessage,
  useEditDmMessage,
  useDeleteDmMessage,
  useSetDmKey,
  useRequestDmKeyAccess,
  useMarkDmThreadRead,
  useDeleteDmThread,
  useRespondToDmThread,
  useToggleDmMessageReaction,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Send,
  Lock,
  ShieldAlert,
  Paperclip,
  Download,
  FileText,
  Phone,
  Video,
  MoreVertical,
  Pencil,
  Trash2,
  Check,
  CheckCheck,
  Search,
  X,
  Smile,
  Reply,
  Mic,
  Square,
  Play,
  Pause,
} from "lucide-react";
import { format } from "date-fns";
import {
  useEncryption,
  useMyDmKey,
  shareDmKeyWithParticipant,
} from "@/hooks/use-encryption";
import {
  encryptMessage,
  decryptMessage,
  encryptFile,
  decryptFile,
  isEncryptedPayload,
} from "@/lib/crypto";
import type { DmMessage } from "@workspace/api-client-react";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB — see ChatRoom.tsx for why
const MAX_RECORDING_SECONDS = 120;

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DmThread() {
  const { threadId } = useParams<{ threadId: string }>();
  const [, navigate] = useLocation();
  const { data: profile } = useGetMyProfile();
  const { data: thread, isLoading: threadLoading } = useGetDmThread(threadId!, {
    query: { enabled: !!threadId, queryKey: getGetDmThreadQueryKey(threadId!) },
  });
  const { data: messages, isLoading: messagesLoading } = useListDmMessages(
    threadId!,
    undefined,
    {
      query: {
        enabled: !!threadId,
        queryKey: getListDmMessagesQueryKey(threadId!),
      },
    },
  );

  const sendDmMessage = useSendDmMessage();
  const editDmMessage = useEditDmMessage();
  const deleteDmMessage = useDeleteDmMessage();
  const setDmKey = useSetDmKey();
  const requestDmKeyAccess = useRequestDmKeyAccess();
  const markThreadRead = useMarkDmThreadRead();
  const deleteDmThread = useDeleteDmThread();
  const respondToDmThread = useRespondToDmThread();
  const [isRespondingToRequest, setIsRespondingToRequest] = useState(false);

  // Message-request state (see PUT /dms/{threadId}/respond and canSendDm on
  // the server — this mirrors that same permission logic client-side so
  // the composer reflects it without a round trip).
  const isIncomingPendingRequest =
    thread?.status === "pending" && !thread.isInitiatedByMe;
  const isOutgoingPendingRequest =
    thread?.status === "pending" && thread.isInitiatedByMe;
  const isBlockedByRejection =
    thread?.status === "rejected" && thread.isInitiatedByMe;
  const canSendMessage = !isIncomingPendingRequest && !isBlockedByRejection;

  const handleRespondToRequest = async (action: "accept" | "reject") => {
    if (!threadId) return;
    setIsRespondingToRequest(true);
    try {
      await respondToDmThread.mutateAsync({ threadId, data: { action } });
      queryClient.invalidateQueries({
        queryKey: getGetDmThreadQueryKey(threadId),
      });
      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
      if (action === "reject") {
        toast({ title: "Message request declined" });
        navigate("/app");
      } else {
        toast({ title: "Message request accepted" });
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't respond to request",
        description: err?.message ?? "Please try again.",
      });
    } finally {
      setIsRespondingToRequest(false);
    }
  };
  const toggleReaction = useToggleDmMessageReaction();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const identity = useEncryption();
  const {
    dmKey,
    status: dmKeyStatus,
    retry: retryDmKey,
  } = useMyDmKey(threadId, identity?.privateKey ?? null);

  const [content, setContent] = useState("");
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(
    null,
  );
  const [isDeleteThreadConfirmOpen, setIsDeleteThreadConfirmOpen] =
    useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastTypingSentAtRef = useRef(0);
  const [replyingTo, setReplyingTo] = useState<DmMessage | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingSecondsRef = useRef(0);
  useEffect(() => {
    recordingSecondsRef.current = recordingSeconds;
  }, [recordingSeconds]);

  // Messages are end-to-end encrypted — the server only ever sees
  // ciphertext, so search has to run client-side over what's already been
  // decrypted in this browser, not as a server-side query.
  const matchingMessageIds = useMemo(() => {
    if (!searchQuery.trim() || !messages) return null;
    const q = searchQuery.trim().toLowerCase();
    return new Set(
      messages
        .filter((m) => (decrypted[m.id] ?? "").toLowerCase().includes(q))
        .map((m) => m.id),
    );
  }, [messages, decrypted, searchQuery]);
  // Read receipts: the other participant's last-read timestamp, seeded from
  // the thread fetch and kept live via the "read" WS event below so a
  // "Seen" checkmark appears on my last message without needing a reload.
  const [otherUserLastReadAt, setOtherUserLastReadAt] = useState<string | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    sendMessage,
    onMessageRef,
    onMessageUpdateRef,
    onReadRef,
    onDmKeyReadyRef,
    onDmKeyRequestedRef,
    onDmThreadDeletedRef,
    onDmRequestRespondedRef,
    onTypingRef,
  } = useThreadWebSocket(threadId);

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
      queryClient.setQueryData(
        getListDmMessagesQueryKey(threadId!),
        (old: any) => {
          if (!old) return [msg];
          if (old.find((m: any) => m.id === msg.id)) return old;
          return [...old, msg];
        },
      );
    };
  }, [threadId, queryClient, onMessageRef]);

  useEffect(() => {
    onMessageUpdateRef.current = (msg) => {
      queryClient.setQueryData(
        getListDmMessagesQueryKey(threadId!),
        (old: any) => {
          if (!old) return old;
          return old.map((m: any) => (m.id === msg.id ? msg : m));
        },
      );
    };
  }, [threadId, queryClient, onMessageUpdateRef]);

  // Live update for the initiator's UI when the recipient accepts/rejects
  // this thread's message request (see PUT /dms/{threadId}/respond) — no
  // reload needed to unlock (or lock) the composer.
  useEffect(() => {
    onDmRequestRespondedRef.current = () => {
      if (!threadId) return;
      queryClient.invalidateQueries({
        queryKey: getGetDmThreadQueryKey(threadId),
      });
      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
    };
  }, [threadId, queryClient, onDmRequestRespondedRef]);

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

  // The other participant's browser lost its copy of the thread key and
  // asked for it back via requestDmKeyAccess. If I'm currently connected
  // here and already hold the decrypted key, re-share it with their (new)
  // public key immediately, rather than making them wait for me to happen
  // to reopen this conversation myself.
  useEffect(() => {
    onDmKeyRequestedRef.current = (requesterId) => {
      if (!dmKey || !thread || !threadId || requesterId === profile?.id) return;
      if (requesterId !== thread.otherUserId || !thread.otherUserPublicKey)
        return;
      shareDmKeyWithParticipant({
        threadId,
        dmKey,
        participantUserId: thread.otherUserId,
        participantPublicKey: thread.otherUserPublicKey,
        setDmKey: (args) => setDmKey.mutateAsync(args),
      }).then(() => {
        queryClient.invalidateQueries({
          queryKey: getGetDmThreadQueryKey(threadId),
        });
      });
    };
  }, [
    onDmKeyRequestedRef,
    dmKey,
    thread,
    threadId,
    profile?.id,
    setDmKey,
    queryClient,
  ]);

  // The other participant deleted this conversation entirely — leave the
  // page (mirrors ChatRoom.tsx's onGroupDeletedRef handling).
  useEffect(() => {
    onDmThreadDeletedRef.current = () => {
      queryClient.invalidateQueries({ queryKey: getListDmThreadsQueryKey() });
      toast({
        title: "Conversation deleted",
        description: "This conversation no longer exists.",
      });
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
      toast({
        variant: "destructive",
        title: "Couldn't delete conversation",
        description: "Please try again.",
      });
    } finally {
      setIsDeleteThreadConfirmOpen(false);
    }
  };

  // Typing indicator — ephemeral, relayed live over WS, never persisted.
  // Each "typing" event refreshes a 3s auto-expiry timer, so it disappears
  // on its own if the other person stops typing without sending.
  useEffect(() => {
    onTypingRef.current = () => {
      setIsOtherTyping(true);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(
        () => setIsOtherTyping(false),
        3000,
      );
    };
  }, [onTypingRef]);

  useEffect(() => {
    return () => clearTimeout(typingTimeoutRef.current);
  }, []);

  const handleTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentAtRef.current < 2000) return;
    lastTypingSentAtRef.current = now;
    sendMessage({ type: "typing" });
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (!threadId) return;
    toggleReaction.mutate(
      { threadId, messageId, data: { emoji } },
      {
        onSuccess: (reactions) => {
          queryClient.setQueryData(
            getListDmMessagesQueryKey(threadId),
            (old: any) => {
              if (!old) return old;
              return old.map((m: any) =>
                m.id === messageId ? { ...m, reactions } : m,
              );
            },
          );
        },
      },
    );
  };

  // Mark the thread read whenever we're looking at it and messages are
  // loaded (covers first open and every new incoming message). Also powers
  // the sidebar's unread badge, which reads the same lastReadAt server-side.
  useEffect(() => {
    if (!threadId || !messages || messages.length === 0) return;
    markThreadRead.mutate(
      { threadId },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getListDmThreadsQueryKey(),
          }),
      },
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
        queryClient.invalidateQueries({
          queryKey: getGetDmThreadQueryKey(threadId),
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmKey, thread, threadId]);

  // Turn decrypted file payloads into blob object URLs for preview/download.
  // Voice messages reuse this same pipeline (they're just an audio file).
  useEffect(() => {
    if (!dmKey || !messages) return;
    let cancelled = false;
    const createdUrls: string[] = [];

    (async () => {
      const next: Record<string, string> = {};
      for (const msg of messages) {
        if (
          (msg.type !== "file" && msg.type !== "voice") ||
          !isEncryptedPayload(msg.content)
        )
          continue;
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

  // Reply/quote previews carry still-encrypted content (see
  // MessageReplyPreview) and the quoted message may not be in the
  // currently-loaded page, so this gets its own decrypt pass.
  const [replyPreviewDecrypted, setReplyPreviewDecrypted] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    if (!dmKey || !messages) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const msg of messages) {
        if (!msg.replyTo || msg.replyTo.deletedAt) continue;
        if (msg.replyTo.type !== "text") continue;
        if (!isEncryptedPayload(msg.replyTo.content)) {
          next[msg.replyTo.id] = msg.replyTo.content;
          continue;
        }
        try {
          next[msg.replyTo.id] = await decryptMessage(
            dmKey,
            msg.replyTo.content,
          );
        } catch {
          next[msg.replyTo.id] = "";
        }
      }
      if (!cancelled) setReplyPreviewDecrypted(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [dmKey, messages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !threadId || !dmKey || !canSendMessage) return;

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
      toast({
        variant: "destructive",
        title: "Couldn't send file",
        description: "An error occurred while uploading.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartRecording = async () => {
    if (!dmKey || isUploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) handleStopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't access microphone",
        description: "Please allow microphone access to send a voice message.",
      });
    }
  };

  const handleStopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleCancelRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    recordedChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  useEffect(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const onStop = async () => {
      if (
        recordedChunksRef.current.length === 0 ||
        !threadId ||
        !dmKey ||
        !canSendMessage
      )
        return;
      const blob = new Blob(recordedChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      recordedChunksRef.current = [];
      const duration = recordingSecondsRef.current;
      setIsSendingVoice(true);
      try {
        const encrypted = await encryptFile(dmKey, blob);
        await sendDmMessage.mutateAsync({
          threadId,
          data: {
            content: encrypted,
            type: "voice",
            fileName: "Voice message",
            mimeType: blob.type,
            fileSize: blob.size,
            durationSeconds: duration,
          },
        });
      } catch {
        toast({
          variant: "destructive",
          title: "Couldn't send voice message",
          description: "Please try again.",
        });
      } finally {
        setIsSendingVoice(false);
        setRecordingSeconds(0);
      }
    };
    recorder.addEventListener("stop", onStop);
    return () => recorder.removeEventListener("stop", onStop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !threadId || !dmKey || !canSendMessage) return;

    const encrypted = await encryptMessage(dmKey, content);
    sendDmMessage.mutate(
      { threadId, data: { content: encrypted, replyToId: replyingTo?.id } },
      {
        onSuccess: () => {
          setContent("");
          setReplyingTo(null);
        },
      },
    );
  };

  const handleSaveEdit = async (e: React.FormEvent, messageId: string) => {
    e.preventDefault();
    if (!editDraft.trim() || !threadId || !dmKey) return;

    const encrypted = await encryptMessage(dmKey, editDraft);
    try {
      await editDmMessage.mutateAsync({
        threadId,
        messageId,
        data: { content: encrypted },
      });
      setEditingMessageId(null);
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't save edit",
        description: "Please try again.",
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingMessageId || !threadId) return;
    try {
      await deleteDmMessage.mutateAsync({
        threadId,
        messageId: deletingMessageId,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't delete message",
        description: "Please try again.",
      });
    } finally {
      setDeletingMessageId(null);
    }
  };

  if (threadLoading)
    return (
      <div className="p-10 flex-1 flex items-center justify-center">
        Loading...
      </div>
    );
  if (!thread) return <div className="p-10">Conversation not found</div>;

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border bg-white px-3 sm:px-6 flex items-center justify-between shadow-sm z-10 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/app" className="md:hidden flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="Back to chats"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <Avatar className="w-9 h-9 border shadow-sm flex-shrink-0">
            {thread.otherUserAvatarUrl && (
              <AvatarImage src={thread.otherUserAvatarUrl} />
            )}
            <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
              {thread.otherUserName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h2 className="font-serif text-lg sm:text-xl font-bold text-foreground truncate max-w-[40vw] sm:max-w-none">
            {thread.otherUserName}
          </h2>

          {dmKeyStatus === "ready" && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Encrypted</span>
            </div>
          )}
          {dmKeyStatus === "missing" && (
            <button
              type="button"
              onClick={() => {
                retryDmKey();
                requestDmKeyAccess.mutate({ threadId: threadId! });
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors px-2.5 py-1 rounded-full"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                Waiting for access — tap to retry
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href={`/app/dms/${threadId}/call?mode=voice`}>
            <Button
              variant="outline"
              className="rounded-full gap-2 px-2.5 sm:px-4"
              aria-label="Voice call"
            >
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">Voice Call</span>
            </Button>
          </Link>

          <Link href={`/app/dms/${threadId}/call`}>
            <Button
              className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-2 px-2.5 sm:px-4"
              aria-label="Video call"
            >
              <Video className="w-4 h-4" />
              <span className="hidden sm:inline">Join Call</span>
            </Button>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground"
            aria-label={isSearchOpen ? "Close search" : "Search messages"}
            onClick={() => {
              setIsSearchOpen((open) => !open);
              if (isSearchOpen) setSearchQuery("");
            }}
          >
            {isSearchOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="rounded-full text-muted-foreground"
                aria-label="Conversation actions"
              >
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

      {isSearchOpen && (
        <div className="flex-none border-b border-border bg-white px-3 sm:px-6 py-2.5">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <Input
              autoFocus
              placeholder="Search this conversation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 border-none shadow-none focus-visible:ring-0 px-0"
            />
            {searchQuery && matchingMessageIds && (
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {matchingMessageIds.size} match
                {matchingMessageIds.size === 1 ? "" : "es"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6">
          {dmKeyStatus === "missing" && (messages?.length ?? 0) > 0 && (
            <div className="flex flex-col sm:flex-row items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl px-4 py-3 text-sm">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <div className="flex-1 text-center sm:text-left">
                This browser lost access to this conversation's encryption key —
                likely from clearing site data. Messages will unlock
                automatically once {thread.otherUserName} opens this
                conversation, or you can nudge them now.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full flex-shrink-0 bg-white"
                disabled={requestDmKeyAccess.isPending}
                onClick={() => {
                  requestDmKeyAccess.mutate({ threadId: threadId! });
                  toast({
                    title: "Request sent",
                    description: `Asking ${thread.otherUserName} if they're online right now.`,
                  });
                }}
              >
                Restore access
              </Button>
            </div>
          )}
          {messagesLoading ? null : messages?.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground italic font-serif">
              It's quiet here. Send the first message to {thread.otherUserName}!
            </div>
          ) : matchingMessageIds && matchingMessageIds.size === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              No messages match "{searchQuery}".
            </div>
          ) : (
            messages?.map((msg, idx) => {
              const isMe = msg.senderId === profile?.id;
              const showAvatar =
                !isMe &&
                (idx === 0 || messages[idx - 1].senderId !== msg.senderId);
              const isLastMine =
                isMe &&
                !messages
                  .slice(idx + 1)
                  .some((m) => m.senderId === profile?.id);
              const isSeen =
                isLastMine &&
                !!otherUserLastReadAt &&
                new Date(otherUserLastReadAt) >= new Date(msg.createdAt);

              if (matchingMessageIds && !matchingMessageIds.has(msg.id))
                return null;

              return (
                <div
                  key={msg.id}
                  className={`flex gap-2 group ${isMe ? "justify-end" : "justify-start"}`}
                >
                  {!isMe && (
                    <div className="w-8 flex-shrink-0">
                      {showAvatar && (
                        <Avatar className="w-8 h-8 border shadow-sm">
                          {msg.senderAvatarUrl && (
                            <AvatarImage src={msg.senderAvatarUrl} />
                          )}
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
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-7 h-7 rounded-full text-muted-foreground"
                            aria-label="Message actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {msg.type === "text" && (
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingMessageId(msg.id);
                                setEditDraft(decrypted[msg.id] ?? "");
                              }}
                            >
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

                  <div
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-[75%]`}
                  >
                    {!msg.deletedAt && msg.replyTo && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = document.getElementById(
                            `dm-message-${msg.replyTo!.id}`,
                          );
                          target?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }}
                        className={`mb-1 max-w-full text-left border-l-2 border-primary/40 bg-muted/40 rounded-md px-2.5 py-1.5 text-xs hover:bg-muted/60 transition-colors ${isMe ? "self-end" : "self-start"}`}
                      >
                        <div className="font-medium text-primary/80">
                          {msg.replyTo.senderId === profile?.id
                            ? "You"
                            : msg.replyTo.senderName}
                        </div>
                        <div className="text-muted-foreground truncate max-w-[220px]">
                          {msg.replyTo.deletedAt
                            ? "This message was deleted"
                            : msg.replyTo.type === "file"
                              ? `📎 ${msg.replyTo.fileName ?? "File"}`
                              : msg.replyTo.type === "voice"
                                ? "🎤 Voice message"
                                : (replyPreviewDecrypted[msg.replyTo.id] ??
                                  "…")}
                        </div>
                      </button>
                    )}
                    {msg.deletedAt ? (
                      <div
                        id={`dm-message-${msg.id}`}
                        className="px-4 py-2.5 rounded-2xl text-sm italic text-muted-foreground bg-muted/50 border border-border"
                      >
                        This message was deleted
                      </div>
                    ) : msg.type === "file" ? (
                      <div id={`dm-message-${msg.id}`}>
                        <FileBubble
                          isMe={isMe}
                          fileName={msg.fileName}
                          mimeType={msg.mimeType}
                          fileSize={msg.fileSize}
                          url={fileUrls[msg.id]}
                          ready={
                            !!decrypted[msg.id] ||
                            !isEncryptedPayload(msg.content)
                          }
                          keyMissing={dmKeyStatus === "missing"}
                        />
                      </div>
                    ) : msg.type === "voice" ? (
                      <div id={`dm-message-${msg.id}`}>
                        <VoiceBubble
                          isMe={isMe}
                          durationSeconds={msg.durationSeconds}
                          url={fileUrls[msg.id]}
                          ready={
                            !!decrypted[msg.id] ||
                            !isEncryptedPayload(msg.content)
                          }
                          keyMissing={dmKeyStatus === "missing"}
                        />
                      </div>
                    ) : editingMessageId === msg.id ? (
                      <form
                        onSubmit={(e) => handleSaveEdit(e, msg.id)}
                        className="flex flex-col gap-1.5 w-full min-w-[220px]"
                      >
                        <Input
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          autoFocus
                          className="text-sm"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingMessageId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={
                              !editDraft.trim() || editDmMessage.isPending
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div
                        id={`dm-message-${msg.id}`}
                        className={`
                        px-4 py-2.5 rounded-2xl shadow-sm text-sm
                        ${
                          isMe
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-white border border-border text-foreground rounded-tl-sm"
                        }
                      `}
                      >
                        {isEncryptedPayload(msg.content)
                          ? (decrypted[msg.id] ??
                            (dmKeyStatus === "missing"
                              ? "🔒 Waiting for access to decrypt"
                              : "🔒 Decrypting…"))
                          : msg.content}
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 mt-1 px-1 flex items-center gap-1">
                      {format(new Date(msg.createdAt), "h:mm a")}
                      {msg.editedAt && !msg.deletedAt && <span>(edited)</span>}
                      {isLastMine &&
                        (isSeen ? (
                          <span className="flex items-center gap-0.5 text-primary/70">
                            <CheckCheck className="w-3.5 h-3.5" /> Seen
                          </span>
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        ))}
                      {!msg.deletedAt && (
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo(msg);
                            setEditingMessageId(null);
                            contentInputRef.current?.focus();
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 text-muted-foreground hover:text-foreground"
                          aria-label="Reply"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!msg.deletedAt && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 text-muted-foreground hover:text-foreground"
                              aria-label="React"
                            >
                              <Smile className="w-3.5 h-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align={isMe ? "end" : "start"}
                            className="flex gap-1 p-1.5 w-auto"
                          >
                            {QUICK_REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="text-lg hover:scale-125 transition-transform px-1"
                                onClick={() =>
                                  handleToggleReaction(msg.id, emoji)
                                }
                              >
                                {emoji}
                              </button>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </span>
                    {msg.reactions.length > 0 && (
                      <div
                        className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}
                      >
                        {msg.reactions.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() =>
                              handleToggleReaction(msg.id, r.emoji)
                            }
                            className={`text-xs px-1.5 py-0.5 rounded-full border transition-colors ${
                              r.userIds.includes(profile?.id ?? "")
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-white border-border text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            {r.emoji} {r.userIds.length}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="flex-none px-4 pt-2 bg-white">
        {isOtherTyping && (
          <div className="max-w-3xl mx-auto text-xs text-muted-foreground italic px-2 pb-1">
            {thread.otherUserName} is typing…
          </div>
        )}
        {replyingTo && (
          <div className="max-w-3xl mx-auto flex items-start justify-between gap-2 bg-muted/50 border-l-2 border-primary/50 rounded-md px-3 py-2 mb-1">
            <div className="min-w-0">
              <div className="text-xs font-medium text-primary/80">
                Replying to{" "}
                {replyingTo.senderId === profile?.id
                  ? "yourself"
                  : thread.otherUserName}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {replyingTo.type === "file"
                  ? `📎 ${replyingTo.fileName ?? "File"}`
                  : replyingTo.type === "voice"
                    ? "🎤 Voice message"
                    : (decrypted[replyingTo.id] ?? "…")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Cancel reply"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-none p-4 pt-0 bg-white border-t border-border shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)]">
        {isIncomingPendingRequest ? (
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 bg-muted/40 rounded-xl px-4 py-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {thread.otherUserName}
              </span>{" "}
              wants to send you a message.
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRespondingToRequest}
                onClick={() => handleRespondToRequest("reject")}
              >
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isRespondingToRequest}
                onClick={() => handleRespondToRequest("accept")}
              >
                Accept
              </Button>
            </div>
          </div>
        ) : isBlockedByRejection ? (
          <div className="max-w-3xl mx-auto text-center text-sm text-muted-foreground bg-muted/40 rounded-xl px-4 py-3">
            {thread.otherUserName} has declined your message request. You can no
            longer send messages here.
          </div>
        ) : (
          <>
            {isOutgoingPendingRequest && (
              <div className="max-w-3xl mx-auto text-xs text-muted-foreground px-2 pb-2">
                Message request sent — {thread.otherUserName} hasn't accepted
                yet, but you can keep sending messages.
              </div>
            )}
            <form
              onSubmit={handleSend}
              className="max-w-3xl mx-auto flex items-end gap-3 relative"
            >
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
                disabled={!dmKey || isUploading || isRecording}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a file"
              >
                <Paperclip className="w-5 h-5" />
              </Button>
              {isRecording ? (
                <div className="flex-1 flex items-center gap-3 bg-muted/30 rounded-full px-6 py-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse flex-shrink-0" />
                  <span className="text-sm font-medium tabular-nums">
                    {formatDuration(recordingSeconds)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Recording voice message…
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="rounded-full w-9 h-9"
                      onClick={handleCancelRecording}
                      aria-label="Cancel recording"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      className="rounded-full w-9 h-9"
                      onClick={handleStopRecording}
                      aria-label="Stop and send recording"
                    >
                      <Square className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Input
                  ref={contentInputRef}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    handleTyping();
                  }}
                  placeholder={
                    isUploading
                      ? "Sending file…"
                      : !dmKey
                        ? "Waiting for encryption access…"
                        : "Type a message..."
                  }
                  className="flex-1 bg-muted/30 border-muted-border rounded-full px-6 py-6 text-base shadow-inner focus-visible:ring-1"
                />
              )}
              {!isRecording && !content.trim() && (
                <Button
                  type="button"
                  size="icon"
                  className="rounded-full w-12 h-12 shadow-md flex-shrink-0 absolute right-1 bottom-1"
                  disabled={!dmKey || isUploading || isSendingVoice}
                  onClick={handleStartRecording}
                  aria-label="Record a voice message"
                >
                  <Mic className="w-5 h-5" />
                </Button>
              )}
              {!isRecording && !!content.trim() && (
                <Button
                  type="submit"
                  size="icon"
                  disabled={
                    !content.trim() || sendDmMessage.isPending || !dmKey
                  }
                  className="rounded-full w-12 h-12 shadow-md flex-shrink-0 absolute right-1 bottom-1"
                >
                  <Send className="w-5 h-5 ml-1" />
                </Button>
              )}
            </form>
          </>
        )}
      </div>

      <AlertDialog
        open={!!deletingMessageId}
        onOpenChange={(open) => !open && setDeletingMessageId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. The message (and its attachment, if any)
              will be replaced with "This message was deleted" for both of you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteThreadConfirmOpen}
        onOpenChange={setIsDeleteThreadConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Every message with {thread.otherUserName}{" "}
              will be permanently deleted for both of you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteThread}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
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
  keyMissing,
}: {
  isMe: boolean;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  url?: string;
  ready: boolean;
  keyMissing?: boolean;
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
      <div
        className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm flex items-center gap-2 ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-white border border-border text-foreground rounded-tl-sm"}`}
      >
        <FileText className="w-4 h-4" />
        {fileName ?? "File"} —{" "}
        {keyMissing ? "🔒 Waiting for access" : "🔒 Decrypting…"}
      </div>
    );
  }

  if (isImage) {
    return (
      <a
        href={url}
        download={fileName ?? "image"}
        className="block rounded-2xl overflow-hidden shadow-sm border border-border max-w-xs"
      >
        <img
          src={url}
          alt={fileName ?? "Shared image"}
          className="w-full h-auto object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      download={fileName ?? "file"}
      className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm flex items-center gap-3 hover:opacity-90 transition-opacity ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-white border border-border text-foreground rounded-tl-sm"}`}
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

function VoiceBubble({
  isMe,
  durationSeconds,
  url,
  ready,
  keyMissing,
}: {
  isMe: boolean;
  durationSeconds?: number | null;
  url?: string;
  ready: boolean;
  keyMissing?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!ready || !url) {
    return (
      <div
        className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm flex items-center gap-2 ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-white border border-border text-foreground rounded-tl-sm"}`}
      >
        <Mic className="w-4 h-4" />
        Voice message —{" "}
        {keyMissing ? "🔒 Waiting for access" : "🔒 Decrypting…"}
      </div>
    );
  }

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
  };

  return (
    <div
      className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm flex items-center gap-3 min-w-[180px] ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-white border border-border text-foreground rounded-tl-sm"}`}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          if (audio.duration) setProgress(audio.currentTime / audio.duration);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isMe ? "bg-white/20" : "bg-primary/10"}`}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={`h-1 rounded-full overflow-hidden ${isMe ? "bg-white/25" : "bg-muted"}`}
        >
          <div
            className={`h-full ${isMe ? "bg-white" : "bg-primary"}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
      <span className="text-xs opacity-80 flex-shrink-0 tabular-nums">
        {formatDuration(durationSeconds ?? 0)}
      </span>
    </div>
  );
}
