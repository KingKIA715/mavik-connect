import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search as SearchIcon, MessageSquare, Users } from "lucide-react";
import { searchMessages, type IndexedMessage } from "@/lib/search-index";

function highlightMatch(content: string, query: string) {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content;
  // Show a short window of context around the match rather than the
  // whole message, the way most search UIs snippet long results.
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + query.length + 30);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return (
    prefix +
    content.slice(start, idx) +
    "%%" +
    content.slice(idx, idx + query.length) +
    "%%" +
    content.slice(idx + query.length, end) +
    suffix
  );
}

function Snippet({ content, query }: { content: string; query: string }) {
  const parts = highlightMatch(content, query).split("%%");
  return (
    <span className="text-sm text-muted-foreground">
      {parts.map((part, i) =>
        i === 1 ? (
          <mark key={i} className="bg-primary/20 text-foreground rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

export function SearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IndexedMessage[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const handle = setTimeout(() => {
      searchMessages(query)
        .then(setResults)
        .finally(() => setIsSearching(false));
    }, 200); // small debounce so fast typing doesn't churn IndexedDB reads
    return () => clearTimeout(handle);
  }, [query]);

  const goToResult = (result: IndexedMessage) => {
    onOpenChange(false);
    setQuery("");
    navigate(
      result.kind === "dm"
        ? `/app/dms/${result.targetId}`
        : `/app/groups/${result.targetId}`,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SearchIcon className="w-4 h-4" /> Search messages
          </DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search your conversations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <p className="text-xs text-muted-foreground">
          Only searches messages this device has already opened — your
          messages are end-to-end encrypted, so search never leaves your
          device.
        </p>

        <div className="max-h-80 overflow-y-auto -mx-2 px-2">
          {isSearching && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Searching…
            </p>
          )}
          {!isSearching && query.trim() && results.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No matches in messages you've already opened on this device.
            </p>
          )}
          {results.map((result) => (
            <button
              key={result.key}
              onClick={() => goToResult(result)}
              className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors flex flex-col gap-0.5"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {result.kind === "group" ? (
                  <Users className="w-3 h-3" />
                ) : (
                  <MessageSquare className="w-3 h-3" />
                )}
                <span className="font-medium text-foreground">
                  {result.targetName}
                </span>
                <span>· {result.senderName}</span>
              </div>
              <Snippet content={result.content} query={query} />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
