/**
 * Tiny localStorage-backed flags for the soft, one-time notification
 * permission prompt (see components/NotificationPromptBanner.tsx) — never
 * the raw browser permission popup out of nowhere on login. Wrapped in
 * try/catch since localStorage can throw in some locked-down/private
 * browsing contexts; failing open (never showing the prompt) is the safe
 * default there.
 */
const HAS_SENT_MESSAGE_KEY = "mavik-connect-has-sent-message";
const PROMPT_SHOWN_KEY = "mavik-connect-notif-prompt-shown";

export const MESSAGE_SENT_EVENT = "mavik:message-sent";

export function markFirstMessageSent(): void {
  try {
    if (localStorage.getItem(HAS_SENT_MESSAGE_KEY) !== "1") {
      localStorage.setItem(HAS_SENT_MESSAGE_KEY, "1");
      window.dispatchEvent(new Event(MESSAGE_SENT_EVENT));
    }
  } catch {
    // Ignore — see file header.
  }
}

export function hasEverSentMessage(): boolean {
  try {
    return localStorage.getItem(HAS_SENT_MESSAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function hasNotificationPromptBeenShown(): boolean {
  try {
    return localStorage.getItem(PROMPT_SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markNotificationPromptShown(): void {
  try {
    localStorage.setItem(PROMPT_SHOWN_KEY, "1");
  } catch {
    // Ignore — see file header.
  }
}
