import { useCallback, useEffect, useState } from "react";
import {
  useGetVapidPublicKey,
  getGetVapidPublicKeyQueryKey,
  useSubscribeToPush,
  useUnsubscribeFromPush,
} from "@workspace/api-client-react";

/** Converts the VAPID public key (base64url string) to the Uint8Array
 * format PushManager.subscribe() requires. Standard Web Push boilerplate. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const isSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  typeof Notification !== "undefined";

/**
 * Manages the browser's notification permission + Web Push subscription
 * lifecycle. Safe to call even where push isn't supported at all (old
 * browsers, some iOS versions outside of an installed PWA) — isSupported
 * covers that, and every action is a no-op if it's false rather than
 * throwing, since notifications are an enhancement, never something core
 * chat features should depend on.
 */
export function usePushNotifications() {
  const { data: vapidData } = useGetVapidPublicKey({
    query: { enabled: isSupported, queryKey: getGetVapidPublicKeyQueryKey() },
  });
  const subscribeToPush = useSubscribeToPush();
  const unsubscribeFromPush = useUnsubscribeFromPush();

  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : "denied",
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setIsSubscribed(!!sub))
      .catch(() => setIsSubscribed(false));
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!isSupported || !vapidData?.publicKey) return false;

    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          vapidData.publicKey,
        ) as BufferSource,
      });
    }

    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) return false;

    await subscribeToPush.mutateAsync({
      data: {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      },
    });
    setIsSubscribed(true);
    return true;
  }, [vapidData, subscribeToPush]);

  const disable = useCallback(async (): Promise<void> => {
    if (!isSupported) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await unsubscribeFromPush
        .mutateAsync({ data: { endpoint: sub.endpoint } })
        .catch(() => {});
      await sub.unsubscribe();
    }
    setIsSubscribed(false);
  }, [unsubscribeFromPush]);

  return { isSupported, permission, isSubscribed, enable, disable };
}
