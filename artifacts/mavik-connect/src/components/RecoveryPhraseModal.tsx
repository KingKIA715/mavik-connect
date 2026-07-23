import { useState } from "react";
import { useEncryption } from "@/hooks/use-encryption";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * Mounted app-wide (see App.tsx), driven entirely by useEncryption()'s
 * status. Two distinct flows share this one modal:
 *
 * - "needs-backup-ack": a brand-new identity was just created on this
 *   device. The encrypted backup is already saved server-side — this
 *   screen exists purely so the user has their own copy of the phrase,
 *   since it's never stored anywhere in plaintext, including here.
 * - "needs-restore": this is an existing account, but this browser has
 *   no local key. The user needs to type their phrase back in to restore
 *   the same identity (recovering access to all previously-wrapped
 *   group/DM keys), or start fresh if they've truly lost it (in which
 *   case old messages become permanently unreadable on this device).
 */
export function RecoveryPhraseModal() {
  const { status, recoveryPhrase, acknowledgeBackup, restoreFromPhrase, startFreshIdentity } =
    useEncryption();
  const [confirmed, setConfirmed] = useState(false);
  const [phraseInput, setPhraseInput] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmingFresh, setConfirmingFresh] = useState(false);

  if (status === "needs-backup-ack" && recoveryPhrase) {
    return (
      <Dialog open>
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <DialogTitle>Save your recovery phrase</DialogTitle>
            </div>
            <DialogDescription>
              This is the only way to get back into your encrypted messages
              if you ever lose this device or clear your browser. We don't
              store it — write it down somewhere safe.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-4 font-mono text-sm">
            {recoveryPhrase.map((word, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-muted-foreground w-4 text-right">
                  {i + 1}.
                </span>
                <span>{word}</span>
              </div>
            ))}
          </div>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I've saved these words somewhere safe
          </label>

          <DialogFooter>
            <Button disabled={!confirmed} onClick={acknowledgeBackup}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (status === "needs-restore") {
    return (
      <Dialog open>
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <DialogTitle>Restore your messages</DialogTitle>
            </div>
            <DialogDescription>
              This device doesn't have your encryption key yet. Enter your
              12-word recovery phrase to get back into your existing
              conversations.
            </DialogDescription>
          </DialogHeader>

          {!confirmingFresh ? (
            <>
              <Input
                placeholder="word1 word2 word3 ..."
                value={phraseInput}
                onChange={(e) => {
                  setPhraseInput(e.target.value);
                  setRestoreError(null);
                }}
                className="font-mono"
              />
              {restoreError && (
                <p className="text-sm text-destructive">{restoreError}</p>
              )}
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button
                  className="w-full"
                  disabled={isRestoring || !phraseInput.trim()}
                  onClick={async () => {
                    setIsRestoring(true);
                    setRestoreError(null);
                    try {
                      await restoreFromPhrase(phraseInput);
                    } catch (err) {
                      setRestoreError(
                        err instanceof Error
                          ? err.message
                          : "That phrase didn't work. Double-check the words and try again.",
                      );
                    } finally {
                      setIsRestoring(false);
                    }
                  }}
                >
                  {isRestoring ? "Restoring…" : "Restore"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => setConfirmingFresh(true)}
                >
                  I don't have my recovery phrase
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <p>
                  Starting fresh generates a new key on this device. You'll
                  get a new recovery phrase, but any messages from before
                  today will stay unreadable here unless someone still has
                  the old key to re-share it with you.
                </p>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={startFreshIdentity}
                >
                  Start fresh anyway
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setConfirmingFresh(false)}
                >
                  Go back
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
