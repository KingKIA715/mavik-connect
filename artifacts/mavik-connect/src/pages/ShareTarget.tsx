import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import {
  useListGroups,
  useListDmThreads,
  useGetMyProfile,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Share2, Users, MessageCircle } from "lucide-react";

/**
 * The target of the manifest's `share_target` entry — this is what opens
 * when someone shares a link or text into Mavik Connect from their OS
 * share sheet (a photo app, Safari, another messaging app, etc). GET-based
 * share targets only carry `title`/`text`/`url` — file sharing would need
 * a POST + multipart form target, which isn't wired up here yet.
 *
 * Picking a conversation navigates there with the shared content pre-filled
 * in the compose box (see the `draft` query param handling in
 * DmThread.tsx/ChatRoom.tsx) rather than sending it automatically — the
 * user still gets to review/edit before it actually sends.
 */
export default function ShareTarget() {
  const [, navigate] = useLocation();
  const [params] = useSearchParams();
  const { data: groups } = useListGroups();
  const { data: threads } = useListDmThreads();
  const { data: profile } = useGetMyProfile();
  const [query, setQuery] = useState("");

  const sharedText = useMemo(() => {
    const title = params.get("title")?.trim();
    const text = params.get("text")?.trim();
    const url = params.get("url")?.trim();
    return [title, text, url].filter(Boolean).join(" ").trim();
  }, [params]);

  const filteredGroups = (groups ?? []).filter((g) =>
    g.name.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredThreads = (threads ?? []).filter((t) =>
    t.otherUserName?.toLowerCase().includes(query.toLowerCase()),
  );

  const goTo = (path: string) => {
    navigate(
      sharedText
        ? `${path}?draft=${encodeURIComponent(sharedText)}`
        : path,
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-2 text-primary">
          <Share2 className="w-5 h-5" />
          <h1 className="font-serif text-xl font-semibold">
            Share to Mavik Connect
          </h1>
        </div>

        {sharedText && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground line-clamp-3">
              {sharedText}
            </CardContent>
          </Card>
        )}

        <input
          className="w-full rounded-md border px-3 py-2 text-sm bg-background"
          placeholder="Search people and groups..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {filteredGroups.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" /> Groups
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {filteredGroups.map((group) => (
                <Button
                  key={group.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => goTo(`/app/groups/${group.id}`)}
                >
                  {group.name}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        {filteredThreads.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <MessageCircle className="w-4 h-4" /> People
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {filteredThreads.map((thread) => (
                <Button
                  key={thread.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => goTo(`/app/dms/${thread.id}`)}
                >
                  {thread.otherUserName}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        {!profile && (
          <p className="text-sm text-muted-foreground text-center">
            Loading your conversations…
          </p>
        )}
      </div>
    </div>
  );
}
