import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGroup,
  useListMessages,
  useSendMessage,
  useEditMessage,
  useDeleteMessage,
  useAddGroupMember,
  useRemoveGroupMember,
  useDeleteGroup,
  useSetGroupAvatar,
  useToggleMessageReaction,
  useGetMyProfile,
  useSetGroupKey,
  useRequestGroupKeyAccess,
  useMarkGroupRead,
  getListMessagesQueryKey,
  getGetGroupQueryKey,
  getListGroupsQueryKey,
} from "@workspace/api-client-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Video,
  Phone,
  Send,
  UserPlus,
  Users,
  Lock,
  ShieldAlert,
  Crown,
  Paperclip,
  Download,
  FileText,
  Check,
  CheckCheck,
  Search,
  X,
  Camera,
  Smile,
  Reply,
  Mic,
  Square,
  Play,
  Pause,
  AtSign,
} from "lucide-react";
import { format } from "date-fns";
import {
  useEncryption,
  useMyGroupKey,
  shareGroupKeyWithMember,
} from "@/hooks/use-encryption";
import {
  encryptMessage,
  decryptMessage,
  encryptFile,
  decryptFile,
  isEncryptedPayload,
} from "@/lib/crypto";
import type { Message } from "@workspace/api-client-react";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB — keep encrypted+base64 payload comfortably under the server's 15mb JSON limit
const MAX_RECORDING_SECONDS = 120; // keep voice messages short — same spirit as MAX_FILE_SIZE

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * Renders message text with @mentions of current group members highlighted.
 * Matching is done against members' current display names — a mention is
 * just "@" + the exact name text the composer inserted, so this is a plain
 * substring split, not a stored offset/range.
 */
function renderContentWithMentions(
  content: string,
  members: { userId: string; name: string }[],
  currentUserId?: string,
): React.ReactNode {
  if (members.length === 0) return content;
  const names = members
    .map((m) => m.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first so "Sam" doesn't shadow "Samantha"
  const pattern = new RegExp(
    `(@(?:${names.map(escapeRegExp).join("|")}))(?![\\w])`,
    "g",
  );
  const parts = content.split(pattern);
  return parts.map((part, i) => {
    const match = part.startsWith("@")
      ? members.find((m) => `@${m.name}` === part)
      : undefined;
    if (match) {
      const isCurrentUser = match.userId === currentUserId;
      return (
        <span
          key={i}
          className={`font-medium rounded px-0.5 ${isCurrentUser ? "bg-amber-200/60 text-amber-900" : "bg-primary/10 text-primary"}`}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function ChatRoom() {
  const { groupId } = useParams<{ groupId: string }>();
  const [, navigate] = useLocation();
  const { data: profile } = useGetMyProfile();
  const { data: group, isLoading: groupLoading } = useGetGroup(groupId!, {
    query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId!) },
  });
  const { data: messages, isLoading: messagesLoading } = useListMessages(
    groupId!,
    undefined,
    {
      query: {
        enabled: !!groupId,
        queryKey: getListMessagesQueryKey(groupId!),
      },
    },
  );

  const sendMessage = useSendMessage();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const deleteGroup = useDeleteGroup();
  const setGroupAvatar = useSetGroupAvatar();
  const toggleReaction = useToggleMessageReaction();
  const setGroupKey = useSetGroupKey();
  const requestGroupKeyAccess = useRequestGroupKeyAccess();
  const markGroupRead = useMarkGroupRead();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const identity = useEncryption();
  const {
    groupKey,
    status: groupKeyStatus,
    retry: retryGroupKey,
  } = useMyGroupKey(groupId, identity?.privateKey ?? null);

  const [content, setContent] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(
    null,
  );
  const [isDeleteGroupConfirmOpen, setIsDeleteGroupConfirmOpen] =
    useState(false);
  const [isLeaveGroupConfirmOpen, setIsLeaveGroupConfirmOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const typingTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const lastTypingSentAtRef = useRef(0);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupPhotoInputRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    isConnected,
    sendMessage: sendWsMessage,
    onMessageRef,
    onMessageUpdateRef,
    onGroupDeletedRef,
    onReadRef,
    onGroupKeyReadyRef,
    onGroupKeyRequestedRef,
    onMemberRemovedRef,
    onTypingRef,
  } = useWebSocket(groupId);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle incoming WS messages
  useEffect(() => {
    onMessageRef.current = (msg) => {
      queryClient.setQueryData(
        getListMessagesQueryKey(groupId!),
        (old: any) => {
          if (!old) return [msg];
          if (old.find((m: any) => m.id === msg.id)) return old; // dedupe
          return [...old, msg];
        },
      );
    };
  }, [groupId, queryClient, onMessageRef]);

  // Handle incoming edits/deletes (a delete is just an update where
  // deletedAt gets set and content/attachment fields are cleared).
  useEffect(() => {
    onMessageUpdateRef.current = (msg) => {
      queryClient.setQueryData(
        getListMessagesQueryKey(groupId!),
        (old: any) => {
          if (!old) return old;
          return old.map((m: any) => (m.id === msg.id ? msg : m));
        },
      );
    };
  }, [groupId, queryClient, onMessageUpdateRef]);

  // The creator deleted this group entirely — everyone currently viewing it
  // (including the creator's own other tabs) gets kicked back to the chat list.
  useEffect(() => {
    onGroupDeletedRef.current = () => {
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      toast({
        title: "Group deleted",
        description: "This group no longer exists.",
      });
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

  // Someone else's browser lost its copy of the group key (e.g. they
  // cleared site data) and asked for it back via requestGroupKeyAccess. If
  // I already hold the decrypted key and I'm currently connected here,
  // re-share it with their (new) public key right away — no need for them
  // to wait until I happen to reopen this group myself.
  useEffect(() => {
    onGroupKeyRequestedRef.current = (requesterId) => {
      if (!groupKey || !group || !groupId || requesterId === profile?.id)
        return;
      const requester = group.members.find((m) => m.userId === requesterId);
      if (!requester?.publicKey) return;
      shareGroupKeyWithMember({
        groupId,
        groupKey,
        memberUserId: requester.userId,
        memberPublicKey: requester.publicKey,
        setGroupKey: (args) => setGroupKey.mutateAsync(args),
      }).then(() => {
        queryClient.invalidateQueries({
          queryKey: getGetGroupQueryKey(groupId),
        });
      });
    };
  }, [
    onGroupKeyRequestedRef,
    groupKey,
    group,
    groupId,
    profile?.id,
    setGroupKey,
    queryClient,
  ]);

  // Someone left, or was removed by the creator: if it was me, leave the
  // page; otherwise just drop them from the cached member list live.
  useEffect(() => {
    onMemberRemovedRef.current = (userId) => {
      if (userId === profile?.id) {
        queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
        toast({
          title: "Removed from group",
          description: "You're no longer a member of this group.",
        });
        navigate("/app");
        return;
      }
      queryClient.setQueryData(getGetGroupQueryKey(groupId!), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          members: old.members.filter((m: any) => m.userId !== userId),
        };
      });
    };
  }, [groupId, profile?.id, queryClient, onMemberRemovedRef, toast, navigate]);

  const handleConfirmLeaveGroup = async () => {
    if (!groupId || !profile) return;
    try {
      await removeMember.mutateAsync({ groupId, userId: profile.id });
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      navigate("/app");
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't leave group",
        description: "Please try again.",
      });
    } finally {
      setIsLeaveGroupConfirmOpen(false);
    }
  };

  // Group photos aren't E2E-encrypted (see the schema comment on
  // groups.avatarUrl), so we keep the payload small client-side rather than
  // relying on the server to reject an oversized upload: resize to a
  // 128x128 thumbnail and JPEG-compress before sending.
  const handleGroupPhotoSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !groupId) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Please choose an image file" });
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = () => {
          img.onload = () => {
            const size = 128;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Canvas not supported"));
              return;
            }
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          };
          img.onerror = () => reject(new Error("Couldn't read image"));
          img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error("Couldn't read file"));
        reader.readAsDataURL(file);
      });

      await setGroupAvatar.mutateAsync({
        groupId,
        data: { avatarUrl: dataUrl },
      });
      queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't update group photo",
        description: "Please try again.",
      });
    }
  };

  // Typing indicators are ephemeral — relayed live over WS, never persisted.
  // Each "typing" event refreshes a 3s auto-expiry timer for that user, so
  // the indicator disappears on its own if they stop typing without sending.
  useEffect(() => {
    onTypingRef.current = (userId) => {
      if (userId === profile?.id) return;
      setTypingUserIds((prev) =>
        prev.includes(userId) ? prev : [...prev, userId],
      );
      clearTimeout(typingTimeoutsRef.current[userId]);
      typingTimeoutsRef.current[userId] = setTimeout(() => {
        setTypingUserIds((prev) => prev.filter((id) => id !== userId));
      }, 3000);
    };
  }, [profile?.id, onTypingRef]);

  useEffect(() => {
    const timeouts = typingTimeoutsRef.current;
    return () => {
      Object.values(timeouts).forEach(clearTimeout);
    };
  }, []);

  const handleTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentAtRef.current < 2000) return;
    lastTypingSentAtRef.current = now;
    sendWsMessage({ type: "typing" });
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (!groupId) return;
    toggleReaction.mutate(
      { groupId, messageId, data: { emoji } },
      {
        onSuccess: (reactions) => {
          queryClient.setQueryData(
            getListMessagesQueryKey(groupId),
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

  // Mark the group read whenever we're looking at it and messages are
  // loaded. Also powers the sidebar's unread badge (same lastReadAt,
  // read server-side).
  useEffect(() => {
    if (!groupId || !messages || messages.length === 0) return;
    markGroupRead.mutate(
      { groupId },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() }),
      },
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
          queryClient.invalidateQueries({
            queryKey: getGetGroupQueryKey(groupId),
          });
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, group, groupId]);

  // For file messages, turn the decrypted base64 payload into a Blob object
  // URL so it can be previewed (images) or downloaded. Revoke old URLs when
  // messages/groupKey change to avoid leaking memory. Voice messages reuse
  // this same pipeline — they're just an audio file under the hood.
  useEffect(() => {
    if (!groupKey || !messages) return;
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

  // Reply/quote previews are denormalized snapshots of the quoted message
  // (see MessageReplyPreview) whose `content` is still E2E ciphertext, so
  // it needs its own decrypt pass — the quoted message may not even be in
  // the currently-loaded page of `messages`, so we can't just look it up
  // in `decrypted` above.
  const [replyPreviewDecrypted, setReplyPreviewDecrypted] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    if (!groupKey || !messages) return;
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
            groupKey,
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
      toast({
        variant: "destructive",
        title: "Couldn't send file",
        description: "An error occurred while uploading.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Voice messages: record with MediaRecorder, then send through the exact
  // same encrypt-and-upload path as a regular file attachment (type "voice"
  // instead of "file", plus a duration).
  const handleStartRecording = async () => {
    if (!groupKey || isUploading) return;
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
          if (s + 1 >= MAX_RECORDING_SECONDS) {
            handleStopRecording();
          }
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

  // recordingSeconds is read from inside the recorder's onstop handler
  // below, which closes over a stale value unless mirrored into a ref.
  const recordingSecondsRef = useRef(0);
  useEffect(() => {
    recordingSecondsRef.current = recordingSeconds;
  }, [recordingSeconds]);

  // Fires once the recorder has actually stopped and flushed its final
  // chunk — `recorder.onstop` runs asynchronously relative to calling
  // .stop(), so we can't just read recordedChunksRef right after
  // handleStopRecording returns.
  useEffect(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const onStop = async () => {
      if (recordedChunksRef.current.length === 0 || !groupId || !groupKey)
        return;
      const blob = new Blob(recordedChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      recordedChunksRef.current = [];
      const duration = recordingSecondsRef.current;
      setIsSendingVoice(true);
      try {
        const encrypted = await encryptFile(groupKey, blob);
        await sendMessage.mutateAsync({
          groupId,
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

  // @Mentions: watches the composer for an "@" that starts a mention
  // (start of string or preceded by whitespace) with no space typed since,
  // and surfaces a filtered dropdown of current group members to tag.
  const handleContentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setContent(value);
    handleTyping();

    const cursor = e.target.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const match = uptoCursor.match(/(?:^|\s)@([^\s@]*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || !group) return [];
    const q = mentionQuery.toLowerCase();
    return group.members
      .filter(
        (m) => m.userId !== profile?.id && m.name.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [mentionQuery, group, profile?.id]);

  const handleSelectMention = (member: { userId: string; name: string }) => {
    const cursor = contentInputRef.current?.selectionStart ?? content.length;
    const uptoCursor = content.slice(0, cursor);
    const replaced = uptoCursor.replace(
      /(?:^|\s)@([^\s@]*)$/,
      (m) => (m.startsWith(" ") ? " " : "") + `@${member.name} `,
    );
    const nextContent = replaced + content.slice(cursor);
    setContent(nextContent);
    setMentionQuery(null);
    contentInputRef.current?.focus();
  };

  // Recomputes which current members are actually still tagged in the
  // final text at send time — more robust than tracking selections
  // through further edits, since the user might delete part of a name.
  function getMentionedUserIds(text: string): string[] {
    if (!group) return [];
    return group.members
      .filter((m) =>
        new RegExp(`(?:^|\\s)@${escapeRegExp(m.name)}(?!\\w)`).test(text),
      )
      .map((m) => m.userId);
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !groupId || !groupKey) return;

    const encrypted = await encryptMessage(groupKey, content);
    sendMessage.mutate(
      {
        groupId,
        data: {
          content: encrypted,
          replyToId: replyingTo?.id,
          mentionedUserIds: getMentionedUserIds(content),
        },
      },
      {
        onSuccess: () => {
          setContent("");
          setReplyingTo(null);
          setMentionQuery(null);
        },
      },
    );
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !groupId) return;

    addMember.mutate(
      { groupId, data: { email: inviteEmail } },
      {
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

          queryClient.invalidateQueries({
            queryKey: getGetGroupQueryKey(groupId),
          });
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: "Couldn't add member",
            description:
              err.status === 404
                ? "No account found for that email yet. Ask them to sign up first!"
                : "An error occurred.",
          });
        },
      },
    );
  };

  const handleSaveEdit = async (e: React.FormEvent, messageId: string) => {
    e.preventDefault();
    if (!editDraft.trim() || !groupId || !groupKey) return;

    const encrypted = await encryptMessage(groupKey, editDraft);
    try {
      await editMessage.mutateAsync({
        groupId,
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
    if (!deletingMessageId || !groupId) return;
    try {
      await deleteMessage.mutateAsync({
        groupId,
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

  const handleConfirmDeleteGroup = async () => {
    if (!groupId) return;
    try {
      await deleteGroup.mutateAsync({ groupId });
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      navigate("/app");
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't delete group",
        description: "Please try again.",
      });
    } finally {
      setIsDeleteGroupConfirmOpen(false);
    }
  };

  if (groupLoading)
    return (
      <div className="p-10 flex-1 flex items-center justify-center">
        Loading...
      </div>
    );
  if (!group) return <div className="p-10">Group not found</div>;

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border bg-white px-3 sm:px-6 flex items-center justify-between shadow-sm z-10 gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
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
          <Avatar className="w-9 h-9 border shadow-sm flex-shrink-0 hidden sm:flex">
            {group.avatarUrl && <AvatarImage src={group.avatarUrl} />}
            <AvatarFallback className="bg-primary/10 text-primary">
              <Users className="w-4 h-4" />
            </AvatarFallback>
          </Avatar>
          <h2 className="font-serif text-lg sm:text-xl font-bold text-foreground truncate max-w-[40vw] sm:max-w-none">
            {group.name}
          </h2>
          <Dialog open={isMembersOpen} onOpenChange={setIsMembersOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/70 transition-colors px-2.5 py-1 rounded-full flex-shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {group.members.length} members
                </span>
                <span className="sm:hidden">{group.members.length}</span>
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">
                  Family Members
                </DialogTitle>
              </DialogHeader>

              <div className="flex flex-col items-center gap-2 pb-2">
                <input
                  ref={groupPhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleGroupPhotoSelect}
                />
                <button
                  type="button"
                  className="relative group/avatar"
                  onClick={() => groupPhotoInputRef.current?.click()}
                  aria-label="Change group photo"
                  disabled={setGroupAvatar.isPending}
                >
                  <Avatar className="w-20 h-20 border shadow-sm">
                    {group.avatarUrl && <AvatarImage src={group.avatarUrl} />}
                    <AvatarFallback className="bg-primary/10 text-primary">
                      <Users className="w-8 h-8" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </button>
                <span className="text-xs text-muted-foreground">
                  Tap to change photo
                </span>
              </div>

              <div className="space-y-3 pt-2 max-h-96 overflow-y-auto">
                {group.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                  >
                    <Avatar className="w-10 h-10 border shadow-sm flex-shrink-0">
                      {member.avatarUrl && (
                        <AvatarImage src={member.avatarUrl} />
                      )}
                      <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
                        {member.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {member.name}
                        </span>
                        {member.role === "owner" && (
                          <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
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
              {group.createdBy === profile?.id ? (
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
              ) : (
                <Button
                  variant="outline"
                  className="w-full mt-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setIsMembersOpen(false);
                    setIsLeaveGroupConfirmOpen(true);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Leave Group
                </Button>
              )}
            </DialogContent>
          </Dialog>
          {groupKeyStatus === "ready" && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Encrypted</span>
            </div>
          )}
          {groupKeyStatus === "missing" && (
            <button
              type="button"
              onClick={() => {
                retryGroupKey();
                requestGroupKeyAccess.mutate({ groupId: groupId! });
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

        <div className="flex items-center gap-1.5 sm:gap-3">
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

          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full gap-1.5 text-muted-foreground px-2.5 sm:px-3"
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Invite</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">
                  Invite a Family Member
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email Address</label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="mom@example.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    They must have created an account first.
                  </p>
                </div>
                <Button
                  type="submit"
                  disabled={addMember.isPending}
                  className="w-full"
                >
                  {addMember.isPending ? "Inviting..." : "Invite"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Link href={`/app/groups/${groupId}/call?mode=voice`}>
            <Button
              variant="outline"
              className="rounded-full gap-2 px-2.5 sm:px-4"
              aria-label="Voice call"
            >
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">Voice Call</span>
            </Button>
          </Link>

          <Link href={`/app/groups/${groupId}/call`}>
            <Button
              className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-2 px-2.5 sm:px-4"
              aria-label="Video call"
            >
              <Video className="w-4 h-4" />
              <span className="hidden sm:inline">Join Call</span>
            </Button>
          </Link>
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
          {groupKeyStatus === "missing" && (messages?.length ?? 0) > 0 && (
            <div className="flex flex-col sm:flex-row items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl px-4 py-3 text-sm">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <div className="flex-1 text-center sm:text-left">
                This browser lost access to this group's encryption key — likely
                from clearing site data. Messages will unlock automatically once
                another member with access opens this group, or you can nudge
                them now.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full flex-shrink-0 bg-white"
                disabled={requestGroupKeyAccess.isPending}
                onClick={() => {
                  requestGroupKeyAccess.mutate({ groupId: groupId! });
                  toast({
                    title: "Request sent",
                    description:
                      "Asking other members who are online right now.",
                  });
                }}
              >
                Restore access
              </Button>
            </div>
          )}
          {messages?.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground italic font-serif">
              It's quiet here. Send the first message to {group.name}!
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
              const otherMembers = group.members.filter(
                (m) => m.userId !== profile?.id,
              );
              const isSeen =
                isLastMine &&
                otherMembers.length > 0 &&
                otherMembers.every(
                  (m) =>
                    m.lastReadAt &&
                    new Date(m.lastReadAt) >= new Date(msg.createdAt),
                );

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
                    {showAvatar && !isMe && (
                      <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">
                        {msg.senderName}
                      </span>
                    )}
                    {!msg.deletedAt && msg.replyTo && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = document.getElementById(
                            `message-${msg.replyTo!.id}`,
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
                        id={`message-${msg.id}`}
                        className="px-4 py-2.5 rounded-2xl text-sm italic text-muted-foreground bg-muted/50 border border-border"
                      >
                        This message was deleted
                      </div>
                    ) : msg.type === "file" ? (
                      <div id={`message-${msg.id}`}>
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
                          keyMissing={groupKeyStatus === "missing"}
                        />
                      </div>
                    ) : msg.type === "voice" ? (
                      <div id={`message-${msg.id}`}>
                        <VoiceBubble
                          isMe={isMe}
                          durationSeconds={msg.durationSeconds}
                          url={fileUrls[msg.id]}
                          ready={
                            !!decrypted[msg.id] ||
                            !isEncryptedPayload(msg.content)
                          }
                          keyMissing={groupKeyStatus === "missing"}
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
                              !editDraft.trim() || editMessage.isPending
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div
                        id={`message-${msg.id}`}
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
                          ? decrypted[msg.id] === undefined
                            ? groupKeyStatus === "missing"
                              ? "🔒 Waiting for access to decrypt"
                              : "🔒 Decrypting…"
                            : renderContentWithMentions(
                                decrypted[msg.id] ?? "",
                                group.members,
                                profile?.id,
                              )
                          : renderContentWithMentions(
                              msg.content,
                              group.members,
                              profile?.id,
                            )}
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
        {typingUserIds.length > 0 && (
          <div className="max-w-3xl mx-auto text-xs text-muted-foreground italic px-2 pb-1">
            {typingUserIds
              .map(
                (id) =>
                  group.members.find((m) => m.userId === id)?.name ?? "Someone",
              )
              .join(", ")}{" "}
            {typingUserIds.length === 1 ? "is" : "are"} typing…
          </div>
        )}
        {replyingTo && (
          <div className="max-w-3xl mx-auto flex items-start justify-between gap-2 bg-muted/50 border-l-2 border-primary/50 rounded-md px-3 py-2 mb-1">
            <div className="min-w-0">
              <div className="text-xs font-medium text-primary/80">
                Replying to{" "}
                {replyingTo.senderId === profile?.id
                  ? "yourself"
                  : replyingTo.senderName}
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
            disabled={!groupKey || isUploading || isRecording}
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
            <div className="flex-1 relative">
              <Input
                ref={contentInputRef}
                value={content}
                onChange={handleContentChange}
                onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
                placeholder={
                  isUploading
                    ? "Sending file…"
                    : "Type a message... (@ to mention)"
                }
                className="w-full bg-muted/30 border-muted-border rounded-full px-6 py-6 text-base shadow-inner focus-visible:ring-1"
              />
              {mentionQuery !== null && mentionMatches.length > 0 && (
                <div className="absolute bottom-full mb-2 left-2 bg-white border border-border rounded-xl shadow-lg overflow-hidden w-56 z-20">
                  {mentionMatches.map((member) => (
                    <button
                      key={member.userId}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectMention(member)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                    >
                      <AtSign className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      {member.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isRecording && !content.trim() && (
            <Button
              type="button"
              size="icon"
              className="rounded-full w-12 h-12 shadow-md flex-shrink-0 absolute right-1 bottom-1"
              disabled={!groupKey || isUploading || isSendingVoice}
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
              disabled={!content.trim() || sendMessage.isPending || !groupKey}
              className="rounded-full w-12 h-12 shadow-md flex-shrink-0 absolute right-1 bottom-1"
            >
              <Send className="w-5 h-5 ml-1" />
            </Button>
          )}
        </form>
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
              will be replaced with "This message was deleted" for everyone.
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
        open={isDeleteGroupConfirmOpen}
        onOpenChange={setIsDeleteGroupConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the group for everyone — all messages,
              members, and attachments will be gone. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteGroup}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isLeaveGroupConfirmOpen}
        onOpenChange={setIsLeaveGroupConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave "{group.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll stop receiving messages from this group. Another member can
              add you back later if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmLeaveGroup}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave Group
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

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  const [progress, setProgress] = useState(0); // 0-1

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
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
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
