import { useEffect, useRef, useState, useCallback } from "react";
import { useWebSocket } from "./use-websocket";

export function useWebRTC(groupId: string | undefined, currentUserId: string | undefined) {
  const { isConnected, presence, sendMessage, onSignalRef } = useWebSocket(groupId);
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);

  const ICE_SERVERS = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  // Start local media
  const startCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;

      // Announce we joined
      sendMessage({ type: "signal-broadcast", data: { type: "join" } });
    } catch (err) {
      console.error("Failed to get media", err);
    }
  }, [sendMessage]);

  // Leave call
  const leaveCall = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    setLocalStream(null);
    localStreamRef.current = null;

    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    setRemoteStreams({});
    
    // Announce leave
    sendMessage({ type: "signal-broadcast", data: { type: "leave" } });
  }, [sendMessage]);

  // Helper to create a peer connection
  const createPeer = useCallback((peerId: string) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[peerId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({
        ...prev,
        [peerId]: event.streams[0]
      }));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({
          type: "signal",
          to: peerId,
          data: { candidate: event.candidate }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        pc.close();
        delete peersRef.current[peerId];
        setRemoteStreams(prev => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      }
    };

    return pc;
  }, [sendMessage]);

  // Handle incoming signals
  useEffect(() => {
    onSignalRef.current = async (from: string, data: any) => {
      if (!currentUserId || from === currentUserId) return;

      if (data.type === "join") {
        // Peer joined, initiate connection
        const pc = createPeer(from);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendMessage({
          type: "signal",
          to: from,
          data: { offer }
        });
      } else if (data.type === "leave") {
        // Peer left
        if (peersRef.current[from]) {
          peersRef.current[from].close();
          delete peersRef.current[from];
        }
        setRemoteStreams(prev => {
          const next = { ...prev };
          delete next[from];
          return next;
        });
      } else if (data.offer) {
        const pc = createPeer(from);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendMessage({
          type: "signal",
          to: from,
          data: { answer }
        });
      } else if (data.answer) {
        const pc = peersRef.current[from];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      } else if (data.candidate) {
        const pc = peersRef.current[from];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      }
    };
  }, [currentUserId, createPeer, sendMessage, onSignalRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      Object.values(peersRef.current).forEach(pc => pc.close());
    };
  }, []);

  return {
    localStream,
    remoteStreams,
    startCall,
    leaveCall,
    isConnected,
    presence
  };
}
