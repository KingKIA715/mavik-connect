import { useEffect, useRef, useState, useCallback } from "react";
import { Message } from "@workspace/api-client-react";

type WsMessage = 
  | { type: "message"; message: Message }
  | { type: "presence"; userIds: string[] }
  | { type: "signal"; from: string; data: any }
  | { type: "signal-broadcast"; data: any };

export function useWebSocket(groupId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [presence, setPresence] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Callbacks for different message types
  const onMessageRef = useRef<((msg: Message) => void) | null>(null);
  const onSignalRef = useRef<((from: string, data: any) => void) | null>(null);

  useEffect(() => {
    if (!groupId) return;

    // Connect to standard /api/ws
    const wsUrl = new URL(`${import.meta.env.BASE_URL}api/ws`, window.location.href);
    wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');
    wsUrl.searchParams.set("groupId", groupId);

    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsMessage;
        if (data.type === "message" && onMessageRef.current) {
          onMessageRef.current(data.message);
        } else if (data.type === "presence") {
          setPresence(data.userIds);
        } else if (data.type === "signal" && onSignalRef.current) {
          onSignalRef.current(data.from, data.data);
        }
      } catch (err) {
        console.error("Failed to parse WS message", err);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [groupId]);

  const sendMessage = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return {
    isConnected,
    presence,
    sendMessage,
    onMessageRef,
    onSignalRef
  };
}
