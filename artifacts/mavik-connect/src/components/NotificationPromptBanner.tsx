import { useEffect, useState } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
  MESSAGE_SENT_EVENT,
  hasEverSentMessage,
  hasNotificationPromptBeenShown,
  markNotificationPromptShown,
} from "@/lib/notification-prompt";
import { Button } from "@/components/ui/button";
import { Bell, X } from "lucide-react";

/**
 * Shown at most once, ever, per browser — after the user's first
 * successfully-sent message (see markFirstMessageSent, called from
 * DmThread/ChatRoom's send handlers), not as a raw browser permission
 * popup out of nowhere on login. Dismissing it (either button) marks it
 * shown for good; notifications can still be turned on later from
 * Settings > Notifications.
 */
export function NotificationPromptBanner({ enabled }: { enabled: boolean }) {
  const { isSupported, permission, enable } = usePushNotifications();
  const [visible, setVisible] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

  const checkShouldShow = () => {
    if (
      isSupported &&
      permission === "default" &&
      hasEverSentMessage() &&
      !hasNotificationPromptBeenShown()
    ) {
      setVisible(true);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    checkShouldShow();
    window.addEventListener(MESSAGE_SENT_EVENT, checkShouldShow);
    return () =>
      window.removeEventListener(MESSAGE_SENT_EVENT, checkShouldShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSupported, permission]);

  if (!enabled || !visible) return null;

  const dismiss = () => {
    markNotificationPromptShown();
    setVisible(false);
  };

  const handleEnable = async () => {
    setIsEnabling(true);
    try {
      await enable();
    } finally {
      markNotificationPromptShown();
      setVisible(false);
    }
  };

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:left-auto z-40 sm:max-w-sm">
      <div className="bg-white border border-border shadow-xl rounded-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Bell className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Turn on notifications?</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Get notified about new messages and calls, even when the app isn't
            open. We'll never show what a message says — just who it's from.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full"
              onClick={handleEnable}
              disabled={isEnabling}
            >
              Enable
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full"
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
