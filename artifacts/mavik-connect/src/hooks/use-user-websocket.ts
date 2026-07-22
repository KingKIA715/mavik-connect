import { useEffect, useRef, useState, useCallback } from "react";

export interface IncomingCallEvent {
  callId: string;
  threadId: string;
  kind: "audio" | "video";
  fromUserId: string;
  fromName: string;
  fromAvatarUrl: string | null;
}

type UserWsMessage =
  | {
      type: "incoming-call";
      callId: string;
      threadId: string;
      kind: "audio" | "video";
      fromUserId: string;
      fromName: string;
      fromAvatarUrl: string | null;
    }
  | { type: "call-answered"; callId: string }
  | { type: "call-declined"; callId: string }
  | { type: "call-cancelled"; callId: string };

/**
 * App-wide connection (`/api/ws?scope=user`) separate from the per-group
 * and per-thread ones in use-websocket.ts — stays open for as long as the
 * user is signed in, regardless of which conversation (if any) they're
 * currently looking at. Exists purely to deliver events that need to reach
 * the user no matter what page they're on: today, just incoming-call
 * ringing. See ws/hub.ts on the server for the full protocol doc.
 */
export function useUserWebSocket(enabled: boolean) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const onIncomingCallRef = useRef<((call: IncomingCallEvent) => void) | null>(
    null,
  );
  const onCallAnsweredRef = useRef<((callId: string) => void) | null>(null);
  const onCallDeclinedRef = useRef<((callId: string) => void) | null>(null);
  const onCallCancelledRef = useRef<((callId: string) => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const wsUrl = new URL(
      `${import.meta.env.BASE_URL}api/ws`,
      window.location.href,
    );
    wsUrl.protocol = wsUrl.protocol.replace("http", "ws");
    wsUrl.searchParams.set("scope", "user");

    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as UserWsMessage;
        if (data.type === "incoming-call" && onIncomingCallRef.current) {
          onIncomingCallRef.current({
            callId: data.callId,
            threadId: data.threadId,
            kind: data.kind,
            fromUserId: data.fromUserId,
            fromName: data.fromName,
            fromAvatarUrl: data.fromAvatarUrl,
          });
        } else if (data.type === "call-answered" && onCallAnsweredRef.current) {
          onCallAnsweredRef.current(data.callId);
        } else if (data.type === "call-declined" && onCallDeclinedRef.current) {
          onCallDeclinedRef.current(data.callId);
        } else if (
          data.type === "call-cancelled" &&
          onCallCancelledRef.current
        ) {
          onCallCancelledRef.current(data.callId);
        }
      } catch (err) {
        console.error("Failed to parse user WS message", err);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [enabled]);

  return {
    isConnected,
    onIncomingCallRef,
    onCallAnsweredRef,
    onCallDeclinedRef,
    onCallCancelledRef,
  };
}
