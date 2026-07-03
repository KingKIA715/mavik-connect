import { useParams } from "wouter";
import { useGetGroup, useGetMyProfile, getGetGroupQueryKey } from "@workspace/api-client-react";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Video, Mic, MicOff, VideoOff, PhoneOff } from "lucide-react";

export default function VideoCall() {
  const { groupId } = useParams<{ groupId: string }>();
  const { data: profile } = useGetMyProfile();
  const { data: group } = useGetGroup(groupId!, { query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId!) } });
  
  const { 
    localStream, 
    remoteStreams, 
    startCall, 
    leaveCall 
  } = useWebRTC(groupId, profile?.id);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    startCall();
    return () => leaveCall();
  }, [startCall, leaveCall]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (!group || !profile) return <div className="p-10">Loading...</div>;

  const remoteIds = Object.keys(remoteStreams);

  return (
    <div className="flex flex-col h-full bg-black text-white relative">
      <div className="p-6 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-10">
        <h1 className="text-2xl font-serif font-bold">{group.name} Call</h1>
      </div>

      <div className="flex-1 p-4 grid gap-4 place-items-center" style={{ 
        gridTemplateColumns: remoteIds.length > 0 ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr" 
      }}>
        {/* Local Video */}
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

        {/* Remote Videos */}
        {remoteIds.map(id => (
          <RemoteVideo key={id} stream={remoteStreams[id]} name={group.members.find(m => m.userId === id)?.name || "Family Member"} />
        ))}
      </div>

      <div className="p-6 bg-gradient-to-t from-black/90 to-transparent flex justify-center gap-6">
        <Button size="icon" variant="secondary" className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 border-0">
          <Mic className="w-6 h-6 text-white" />
        </Button>
        <Button size="icon" variant="secondary" className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 border-0">
          <Video className="w-6 h-6 text-white" />
        </Button>
        <Button size="icon" variant="destructive" className="w-14 h-14 rounded-full" onClick={() => window.history.back()}>
          <PhoneOff className="w-6 h-6" />
        </Button>
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
