import * as crypto from "crypto";
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

interface Challenge {
  realm: string;
  nonce: string;
  qop?: string;
  algorithm?: string;
  opaque?: string;
}

export interface CachedDigestAuthOptions {
  username: string;
  password: string;
  axios: AxiosInstance;
}

/**
 * Minimal RFC 7616 Digest Auth client that caches the challenge across
 * requests so each call after the first skips the 401 round-trip. The TV
 * may rotate its nonce (returns 401 with `stale=true`); when that happens
 * we re-challenge transparently.
 *
 * @mhoc/axios-digest-auth always pays the round-trip cost; on our poll
 * cycle (4 GETs every 10s plus a long-poll) that's ~50% wasted requests.
 */
export class CachedDigestAuth {
  private readonly username: string;
  private readonly password: string;
  private readonly axios: AxiosInstance;
  private challenge: Challenge | null = null;
  private nonceCount = 0;
  private cachedHa1: string | null = null;

  constructor(options: CachedDigestAuthOptions) {
    this.username = options.username;
    this.password = options.password;
    this.axios = options.axios;
  }

  async request(config: AxiosRequestConfig): Promise<AxiosResponse> {
    if (this.challenge) {
      const attempt = await this.axios.request(this.withAuthHeader(config, this.challenge));
      if (!this.is401(attempt)) return attempt;
      // Cached challenge stale or rotated — fall through to fresh challenge.
      this.challenge = null;
      this.cachedHa1 = null;
    }

    const initial = await this.axios.request(config);
    if (!this.is401(initial)) return initial;
    const fresh = this.parseChallenge(initial);
    if (!fresh) return initial;
    this.challenge = fresh;
    return this.axios.request(this.withAuthHeader(config, fresh));
  }

  private is401(response: AxiosResponse): boolean {
    return response.status === 401;
  }

  private parseChallenge(response: AxiosResponse): Challenge | null {
    const header = response.headers["www-authenticate"];
    if (typeof header !== "string" || !header.toLowerCase().startsWith("digest")) return null;
    const params = this.parseAuthParams(header.slice("digest".length));
    const realm = params.realm;
    const nonce = params.nonce;
    if (!realm || !nonce) return null;
    return {
      realm,
      nonce,
      qop: params.qop,
      algorithm: params.algorithm,
      opaque: params.opaque,
    };
  }

  private parseAuthParams(header: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(header)) !== null) {
      const key = match[1].toLowerCase();
      out[key] = (match[2] ?? match[3] ?? "").trim();
    }
    return out;
  }

  private withAuthHeader(config: AxiosRequestConfig, challenge: Challenge): AxiosRequestConfig {
    const method = (config.method ?? "GET").toUpperCase();
    const url = config.url ?? "";
    const uri = this.pathFromUrl(url);
    this.nonceCount += 1;
    const nc = this.nonceCount.toString(16).padStart(8, "0");
    const cnonce = crypto.randomBytes(8).toString("hex");
    const ha1 = this.computeHa1(challenge.realm);
    const ha2 = this.md5(`${method}:${uri}`);
    const qop = this.preferredQop(challenge.qop);
    const responseHash = qop
      ? this.md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : this.md5(`${ha1}:${challenge.nonce}:${ha2}`);

    const parts: string[] = [
      `username="${this.username}"`,
      `realm="${challenge.realm}"`,
      `nonce="${challenge.nonce}"`,
      `uri="${uri}"`,
      `response="${responseHash}"`,
    ];
    if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
    if (qop) {
      parts.push(`qop=${qop}`);
      parts.push(`nc=${nc}`);
      parts.push(`cnonce="${cnonce}"`);
    }
    if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);

    const authorization = `Digest ${parts.join(", ")}`;
    return {
      ...config,
      headers: { ...(config.headers ?? {}), authorization },
    };
  }

  private computeHa1(realm: string): string {
    if (this.cachedHa1 && this.challenge?.realm === realm) return this.cachedHa1;
    const ha1 = this.md5(`${this.username}:${realm}:${this.password}`);
    this.cachedHa1 = ha1;
    return ha1;
  }

  private preferredQop(qop: string | undefined): string | undefined {
    if (!qop) return undefined;
    // qop may be a comma-separated list; prefer "auth" when offered.
    const options = qop.split(",").map((s) => s.trim());
    if (options.includes("auth")) return "auth";
    return options[0];
  }

  private pathFromUrl(fullUrl: string): string {
    try {
      const parsed = new URL(fullUrl);
      return parsed.pathname + parsed.search;
    } catch {
      return fullUrl;
    }
  }

  private md5(input: string): string {
    return crypto.createHash("md5").update(input).digest("hex");
  }
}
