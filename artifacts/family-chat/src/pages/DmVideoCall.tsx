import { useParams, useSearch } from "wouter";
import { useGetDmThread, useGetMyProfile, getGetDmThreadQueryKey } from "@workspace/api-client-react";
import { useThreadWebRTC } from "@/hooks/use-thread-webrtc";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Video, Mic, MicOff, VideoOff, PhoneOff, SwitchCamera } from "lucide-react";

export default function DmVideoCall() {
  const { threadId } = useParams<{ threadId: string }>();
  const search = useSearch();
  const isVoiceOnly = new URLSearchParams(search).get("mode") === "voice";
  const { data: profile } = useGetMyProfile();
  const { data: thread } = useGetDmThread(threadId!, {
    query: { enabled: !!threadId, queryKey: getGetDmThreadQueryKey(threadId!) },
  });

  const {
    localStream,
    remoteStreams,
    startCall,
    leaveCall,
    isMuted,
    isVideoOff,
    hasVideo,
    toggleAudio,
    toggleVideo,
    switchCamera
  } = useThreadWebRTC(threadId, profile?.id);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    startCall({ video: !isVoiceOnly });
    return () => leaveCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCall, leaveCall]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (!thread || !profile) return <div className="p-10">Loading...</div>;

  const remoteIds = Object.keys(remoteStreams);

  return (
    <div className="flex flex-col h-full bg-black text-white relative">
      <div className="p-6 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-10">
        <h1 className="text-2xl font-serif font-bold">{thread.otherUserName} {isVoiceOnly ? "Voice Call" : "Call"}</h1>
      </div>

      <div className="flex-1 p-4 grid gap-4 place-items-center" style={{
        gridTemplateColumns: remoteIds.length > 0 ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr"
      }}>
        {/* Local Tile */}
        {hasVideo ? (
          <div className="relative rounded-2xl overflow-hidden bg-gray-900 shadow-xl aspect-video w-full max-w-3xl">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover transform -scale-x-100"
            />
            <div className="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm">
              You
            </div>
          </div>
        ) : (
          <VoiceTile name="You" avatarUrl={profile.avatarUrl} isMuted={isMuted} />
        )}

        {/* Remote Tile — a DM thread only ever has the one other participant */}
        {remoteIds.map(id => {
          return isVoiceOnly ? (
            <VoiceTile key={id} name={thread.otherUserName} avatarUrl={thread.otherUserAvatarUrl} />
          ) : (
            <RemoteVideo key={id} stream={remoteStreams[id]} name={thread.otherUserName} />
          );
        })}
      </div>

      <div className="p-6 bg-gradient-to-t from-black/90 to-transparent flex justify-center gap-6">
        <Button
          size="icon"
          variant="secondary"
          className={`w-14 h-14 rounded-full border-0 ${isMuted ? "bg-red-500/80 hover:bg-red-500" : "bg-white/10 hover:bg-white/20"}`}
          onClick={toggleAudio}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
        </Button>
        {!isVoiceOnly && (
          <>
            <Button
              size="icon"
              variant="secondary"
              className={`w-14 h-14 rounded-full border-0 ${isVideoOff ? "bg-red-500/80 hover:bg-red-500" : "bg-white/10 hover:bg-white/20"}`}
              onClick={toggleVideo}
              aria-label={isVideoOff ? "Turn camera on" : "Turn camera off"}
            >
              {isVideoOff ? <VideoOff className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 border-0"
              onClick={switchCamera}
              aria-label="Switch camera"
            >
              <SwitchCamera className="w-6 h-6 text-white" />
            </Button>
          </>
        )}
        <Button size="icon" variant="destructive" className="w-14 h-14 rounded-full" onClick={() => window.history.back()}>
          <PhoneOff className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}

function VoiceTile({ name, avatarUrl, isMuted }: { name: string; avatarUrl?: string | null; isMuted?: boolean }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-gray-900 shadow-xl aspect-video w-full max-w-3xl flex items-center justify-center">
      <Avatar className="w-24 h-24 border-2 border-white/10 shadow-xl">
        {avatarUrl && <AvatarImage src={avatarUrl} />}
        <AvatarFallback className="bg-secondary text-secondary-foreground text-3xl">
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm flex items-center gap-1.5">
        {name}
        {isMuted && <MicOff className="w-3.5 h-3.5" />}
      </div>
    </div>
  );
}

function RemoteVideo({ stream, name }: { stream: MediaStream, name: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative rounded-2xl overflow-hidden bg-gray-900 shadow-xl aspect-video w-full max-w-3xl">
      <video
        ref={ref}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm">
        {name}
      </div>
    </div>
  );
}
