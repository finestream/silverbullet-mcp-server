// Cloudflare Access in front of the server (docs/cloudflare-access.md): Access
// logs the user in and adds a signed assertion to every request it lets
// through, in the `Cf-Access-Jwt-Assertion` header. This module verifies that
// assertion (signature through the team domain's keys, issuer = the team
// domain, audience = the application's AUD tag, expiry) and returns the
// e-mail address Access signed in. The address only selects the user's line in
// the credentials file; nothing of the assertion is forwarded.

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { CLOCK_TOLERANCE, isSecureOrLoopback, rejectionOf } from "./jwt.ts";

export type CfAccessConfig = {
  /** The team domain as a URL without a path, `https://<team>.cloudflareaccess.com`: what an assertion carries in `iss`. */
  issuer: string;
  /** The AUD tag of the Access application in front of this server: what an assertion's `aud` must contain. */
  audience: string;
};

/** The header Access adds, as Node names it. */
export const ASSERTION_HEADER = "cf-access-jwt-assertion";

/** Where a team domain publishes its signing keys. */
const CERTS_PATH = "/cdn-cgi/access/certs";

/** Access signs with RS256 and nothing else. */
const ALGORITHMS = ["RS256"];

export type AccessVerified = { ok: true; email: string; claims: JWTPayload };
export type AccessRejected = { ok: false; reason: string };

/** Reads the Access settings; null when the mode is off. Throws on a setting that cannot be right, so the server does not start half-configured. */
export function loadCfAccessConfig(env: NodeJS.ProcessEnv): CfAccessConfig | null {
  const team = env.MCP_CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.MCP_CF_ACCESS_AUD?.trim();
  if (!team && !audience) return null;
  if (!team || !audience) throw new Error("Cloudflare Access needs both MCP_CF_ACCESS_TEAM_DOMAIN and MCP_CF_ACCESS_AUD");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(team) ? team : `https://${team}`);
  } catch {
    throw new Error(`MCP_CF_ACCESS_TEAM_DOMAIN is not a host name or URL: ${team}`);
  }
  if (!isSecureOrLoopback(url)) throw new Error(`MCP_CF_ACCESS_TEAM_DOMAIN must be an https URL (http only for a loopback address): ${team}`);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error(`MCP_CF_ACCESS_TEAM_DOMAIN must be the team domain alone, without path, query, fragment or credentials: ${team}`);
  if (!/^[A-Za-z0-9_-]+$/.test(audience)) throw new Error("MCP_CF_ACCESS_AUD must be the application's AUD tag (letters, digits, - and _)");
  return { issuer: url.origin, audience };
}

export class CfAccessVerifier {
  readonly config: CfAccessConfig;
  private readonly keys: JWTVerifyGetKey;

  /** `keys` replaces the look-up of the team domain's keys, for tests. */
  constructor(config: CfAccessConfig, keys?: JWTVerifyGetKey) {
    this.config = config;
    // Fetched at the first assertion and again when one names an unknown key (Access rotates its keys), so the server starts without the team domain.
    this.keys = keys ?? createRemoteJWKSet(new URL(this.certsUrl()));
  }

  certsUrl(): string {
    return this.config.issuer + CERTS_PATH;
  }

  /** Verifies an assertion. The reason of a rejection is for the log; the client never gets it. */
  async verify(assertion: string): Promise<AccessVerified | AccessRejected> {
    const reject = (reason: string): AccessRejected => ({ ok: false, reason: `Access assertion: ${reason}` });
    let claims: JWTPayload;
    try {
      const verified = await jwtVerify(assertion, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE,
        requiredClaims: ["exp", "iss", "aud"],
      });
      claims = verified.payload;
    } catch (e) {
      return reject(rejectionOf(e, "expired"));
    }
    const email = claims.email;
    // A service token is a client, not a person: its assertion names a `common_name` and no e-mail, so it selects nobody.
    if (typeof email !== "string" || !email) return reject(`no "email" claim (it carries: ${Object.keys(claims).sort().join(", ")})`);
    return { ok: true, email, claims };
  }
}
