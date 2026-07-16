import type { NextFunction, Request, Response } from "express";

/**
 * A minimal per-user sliding-window rate limiter, kept in memory.
 *
 * This is intentionally simple (no Redis, no external deps) to match the
 * scale of this app — a single Replit instance, not a horizontally-scaled
 * cluster. If this server is ever run as multiple instances behind a load
 * balancer, this in-memory limiter would need to move to a shared store
 * (e.g. Redis) since each instance would otherwise track its own count.
 *
 * Purpose is basic abuse/spam protection on message sending, not strict
 * API throttling — the limits below are generous for normal conversation.
 */

interface RateLimitOptions {
  /** Max requests allowed per window, per user. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Shown in the 429 response body. */
  message: string;
}

const buckets = new Map<string, number[]>();

// Periodically drop buckets that haven't been touched in a while, so this
// Map doesn't grow unboundedly over the server's lifetime.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SWEEP_INTERVAL_MS;
  for (const [key, timestamps] of buckets) {
    if (timestamps.every((t) => t < cutoff)) {
      buckets.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();

export function rateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.userId;
    if (!userId) {
      // requireAuth should already have rejected this, but don't rate-limit
      // by a missing key if it somehow gets here.
      next();
      return;
    }

    const now = Date.now();
    const key = `${req.baseUrl}${req.path}:${userId}`;
    const timestamps = (buckets.get(key) ?? []).filter(
      (t) => now - t < options.windowMs,
    );

    if (timestamps.length >= options.max) {
      const retryAfterMs = options.windowMs - (now - timestamps[0]);
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      res.status(429).json({ error: options.message });
      return;
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    next();
  };
}

/**
 * Message-send limit: 20 messages per 10 seconds, per user. Generous for
 * real conversation (bursts of quick replies are fine) while still blocking
 * a scripted flood.
 */
export const messageSendRateLimit = rateLimit({
  max: 20,
  windowMs: 10_000,
  message: "You're sending messages too quickly. Please wait a moment.",
});
