// What the two token verifiers share (oauth.ts for OAuth access tokens,
// cf-access.ts for Cloudflare Access assertions): the URL rule for an issuer
// and its keys, the clock tolerance, and how a failed verification is told.

import { errors } from "jose";

/** Seconds of clock difference tolerated between an issuer and this server. */
export const CLOCK_TOLERANCE = 30;

/** An https URL, or http on a loopback address (a test issuer on the same machine). */
export function isSecureOrLoopback(url: URL): boolean {
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return url.protocol === "https:" || (url.protocol === "http:" && loopback);
}

/** Why `jwtVerify` refused, for the log; `expired` is the text for an expired token. */
export function rejectionOf(e: unknown, expired: string): string {
  if (e instanceof errors.JWTExpired) return expired;
  if (e instanceof errors.JWTClaimValidationFailed) return `claim "${e.claim}": ${e.reason} (${e.message})`;
  if (e instanceof errors.JOSEError) return `${e.code}: ${e.message}`;
  return (e as Error).message;
}
