import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAnswerDmCall, useDeclineDmCall } from "@workspace/api-client-react";
import {
  useUserWebSocket,
  type IncomingCallEvent,
} from "@/hooks/use-user-websocket";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Phone, Video, PhoneOff } from "lucide-react";

/**
 * Mounted once, near the root of the authenticated app (see App.tsx) — not
 * inside ChatsShell — so a call rings no matter what page is open,
 * including Settings, a different conversation, or an existing call
 * screen. Uses the app-wide WebSocket scope (use-user-websocket.ts), not
 * the per-thread one, since the ring needs to reach the user regardless of
 * which (if any) specific conversation they have open.
 */
export function IncomingCallBanner({ enabled }: { enabled: boolean }) {
  const [, navigate] = useLocation();
  const [call, setCall] = useState<IncomingCallEvent | null>(null);
  const answerCall = useAnswerDmCall();
  const declineCall = useDeclineDmCall();

  const { onIncomingCallRef, onCallCancelledRef } = useUserWebSocket(enabled);

  useEffect(() => {
    onIncomingCallRef.current = (incoming) => {
      // If a second call comes in while one's already ringing (e.g. a
      // second device), keep showing the first — one at a time is enough
      // for now rather than trying to stack/queue them.
      setCall((current) => current ?? incoming);
    };
    onCallCancelledRef.current = (callId) => {
      setCall((current) => (current?.callId === callId ? null : current));
    };
  }, [onIncomingCallRef, onCallCancelledRef]);

  if (!call) return null;

  const handleDecline = () => {
    declineCall.mutate({ threadId: call.threadId, callId: call.callId });
    setCall(null);
  };

  const handleAccept = () => {
    answerCall.mutate(
      { threadId: call.threadId, callId: call.callId },
      {
        onSuccess: () => {
          navigate(
            `/app/dms/${call.threadId}/call?mode=${call.kind === "audio" ? "voice" : "video"}&callId=${call.callId}`,
          );
        },
      },
    );
    setCall(null);
  };

  return (
    <div className="fixed top-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto bg-white border border-border shadow-xl rounded-2xl px-4 py-3 flex items-center gap-3 max-w-sm w-full animate-in slide-in-from-top-4 fade-in duration-300">
        <Avatar className="w-10 h-10 border flex-shrink-0">
          {call.fromAvatarUrl && <AvatarImage src={call.fromAvatarUrl} />}
          <AvatarFallback className="bg-secondary text-secondary-foreground">
            {call.fromName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{call.fromName}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {call.kind === "video" ? (
              <Video className="w-3 h-3" />
            ) : (
              <Phone className="w-3 h-3" />
            )}
            Incoming {call.kind === "video" ? "video" : "voice"} call
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="rounded-full w-9 h-9"
            onClick={handleDecline}
            aria-label="Decline call"
          >
            <PhoneOff className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="rounded-full w-9 h-9 bg-emerald-600 hover:bg-emerald-700"
            onClick={handleAccept}
            aria-label="Accept call"
          >
            <Phone className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
