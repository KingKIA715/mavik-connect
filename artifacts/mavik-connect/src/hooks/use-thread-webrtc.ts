import { useEffect, useRef, useState, useCallback } from "react";
import { useThreadWebSocket } from "./use-websocket";

/**
 * Same design as useWebRTC, but for a 1:1 DM thread instead of a group —
 * connects over `/api/ws?threadId=` and relays signaling through
 * useThreadWebSocket instead of useWebSocket. There's always at most one
 * remote peer, but the logic is otherwise identical (kept as a separate
 * hook rather than generalizing useWebRTC, to avoid touching the working
 * group calling code).
 */
export function useThreadWebRTC(threadId: string | undefined, currentUserId: string | undefined) {
  const { isConnected, sendMessage, onSignalRef } = useThreadWebSocket(threadId);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);

  const ICE_SERVERS = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  const startCall = useCallback(async (options?: { video?: boolean }) => {
    const wantVideo = options?.video !== false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setHasVideo(wantVideo && stream.getVideoTracks().length > 0);

      sendMessage({ type: "signal-broadcast", data: { type: "join" } });
    } catch (err) {
      console.error("Failed to get media", err);
    }
  }, [sendMessage]);

  const leaveCall = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    setLocalStream(null);
    localStreamRef.current = null;

    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    setRemoteStreams({});

    sendMessage({ type: "signal-broadcast", data: { type: "leave" } });
  }, [sendMessage]);

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

  useEffect(() => {
    onSignalRef.current = async (from: string, data: any) => {
      if (!currentUserId || from === currentUserId) return;

      if (data.type === "join") {
        const pc = createPeer(from);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendMessage({
          type: "signal",
          to: from,
          data: { offer }
        });
      } else if (data.type === "leave") {
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

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      Object.values(peersRef.current).forEach(pc => pc.close());
    };
  }, []);

  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  }, []);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoOff(!videoTrack.enabled);
  }, []);

  const switchCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const currentVideoTrack = stream.getVideoTracks()[0];
    const nextFacingMode = facingMode === "user" ? "environment" : "user";

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacingMode },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      newVideoTrack.enabled = currentVideoTrack ? currentVideoTrack.enabled : true;

      await Promise.all(
        Object.values(peersRef.current).map(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          return sender ? sender.replaceTrack(newVideoTrack) : Promise.resolve();
        })
      );

      if (currentVideoTrack) {
        stream.removeTrack(currentVideoTrack);
        currentVideoTrack.stop();
      }
      stream.addTrack(newVideoTrack);

      setFacingMode(nextFacingMode);
      setLocalStream(new MediaStream(stream.getTracks()));
      localStreamRef.current = stream;
    } catch (err) {
      console.error("Failed to switch camera", err);
    }
  }, [facingMode]);

  return {
    localStream,
    remoteStreams,
    startCall,
    leaveCall,
    isConnected,
    isMuted,
    isVideoOff,
    hasVideo,
    toggleAudio,
    toggleVideo,
    switchCamera
  };
}
