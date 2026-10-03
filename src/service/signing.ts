/**
 * Requests between the website and the scan service are signed with a
 * shared secret, in both directions: the website proves it may start a
 * scan, and the service proves a callback is really the scan's result.
 *
 * Headers:  X-SSA-Timestamp  unix seconds
 *           X-SSA-Signature  hex HMAC-SHA256 of `${timestamp}.${rawBody}`
 *
 * A signature older than five minutes is refused, so a captured request
 * cannot be replayed later.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-ssa-timestamp";
export const SIGNATURE_HEADER = "x-ssa-signature";
export const MAX_SKEW_SECONDS = 300;

export function sign(secret: string, timestamp: number | string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** The two headers for a request made now. */
export function signedHeaders(secret: string, body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return { [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: sign(secret, timestamp, body) };
}

/** Why a request was refused, or null when it is good. */
export function verify(secret: string, headers: Record<string, string | string[] | undefined>, body: string, now = Date.now()): string | null {
  const ts = headers[TIMESTAMP_HEADER];
  const sig = headers[SIGNATURE_HEADER];
  if (typeof ts !== "string" || typeof sig !== "string") return "missing signature";
  if (!/^\d{1,12}$/.test(ts)) return "bad timestamp";
  if (Math.abs(now / 1000 - Number(ts)) > MAX_SKEW_SECONDS) return "expired signature";
  const expected = Buffer.from(sign(secret, ts, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "bad signature";
  return null;
}
