import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * VAPID keys identify this server to push services (browser vendors) so
 * they'll accept notifications from it. Generate your own with
 * `npx web-push generate-vapid-keys` and set these as real environment
 * variables in your deployment — never commit them to source control.
 * Push sending is a no-op (never throws) if they're not set, e.g. in local
 * dev, so missing/misconfigured push never breaks core messaging.
 */
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:support@example.com";

const isConfigured = !!vapidPublicKey && !!vapidPrivateKey;
if (isConfigured) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey!, vapidPrivateKey!);
} else {
  logger.warn(
    "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications are disabled (messaging itself is unaffected)",
  );
}

export function getVapidPublicKey(): string | null {
  return vapidPublicKey ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** App-relative path to open when the notification is clicked. */
  url?: string;
  /**
   * "call" pushes always ring through regardless of the client's quiet
   * hours setting (see sw.js); anything else — including omitted —
   * is treated as an ordinary message and can be suppressed.
   */
  type?: "message" | "call";
}

/**
 * Sends a push notification to every device/browser userId has previously
 * subscribed from. Deliberately never throws — a push failure should never
 * take down the calling request (a message send, a call ringing, etc.);
 * it's logged and swallowed. Expired/revoked subscriptions (404/410 from
 * the push service) are cleaned up automatically.
 *
 * Payload content must never include message plaintext — the server
 * doesn't have it (messages are E2E encrypted) and shouldn't display it in
 * an OS-level notification tray even if it did. Keep to generic text like
 * "New message from Sarah".
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!isConfigured) return;

  let subs: (typeof pushSubscriptionsTable.$inferSelect)[];
  try {
    subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId));
  } catch (err) {
    logger.error({ err, userId }, "Failed to load push subscriptions");
    return;
  }

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or was revoked by the user/browser —
          // stop trying to send to it.
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, sub.id))
            .catch(() => {});
        } else {
          logger.error({ err, userId }, "Failed to send push notification");
        }
      }
    }),
  );
}
