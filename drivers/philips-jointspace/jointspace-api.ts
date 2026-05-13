import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from "axios";
import * as crypto from "crypto";
import * as https from "https";

import { CachedDigestAuth } from "./cached-digest";

import {
  AmbilightConfiguration,
  AmbiHueState,
  Application,
  ApplicationIntent,
  ApplicationsResponse,
  AudioData,
  ChannelDbTv,
  ChannelList,
  CurrentSource,
  InputKeyDescriptor,
  JointspaceConfig,
  JointspaceCredentials,
  LegacyChannels,
  MenuItemsSettingUpdate,
  NotifyChangePayload,
  NotifyChangeState,
  PairDevice,
  PairGrantResponse,
  PairingState,
  PairRequestResponse,
  PowerState,
  Protocol,
  ScreenState,
  SourcesMap,
  SystemInfo,
} from "./types";
import {
  InvalidResponseError,
  JointspaceError,
  NotFoundError,
  OfflineError,
  PairingError,
  ProtocolError,
  UnauthenticatedError,
} from "./errors";
import { PairingStatus } from "./enums";
import allPossibleInputs from "../../assets/json/allPossibleInputs.json";
import initialNotifyState from "../../assets/json/notifyChange.json";

const PAIR_SHARED_KEY = Buffer.from(
  "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==",
  "base64",
);

const HTTP_PORT = 1925;
const HTTPS_PORT = 1926;

const DEFAULT_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;
const NOTIFY_CHANGE_TIMEOUT_MS = 130_000;

const IGNORED_NON_JSON_RESPONSES = new Set([
  "",
  "Context Service not started",
  "}",
  "<html><head><title>Ok</title></head><body>Ok</body></html>",
]);

export type LogFn = (...args: unknown[]) => void;

export interface JointspaceApiOptions {
  log?: LogFn;
  debug?: boolean;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  data?: unknown;
  port?: number;
  protocol?: Protocol;
  prefixApiVersion?: boolean;
  timeoutMs?: number;
  requireAuth?: boolean;
}

export class JointspaceApi {
  private config: JointspaceConfig;
  private readonly log: LogFn;
  private readonly debug: boolean;
  private readonly httpsAgent: https.Agent;
  private anonClient: AxiosInstance;
  private digestClient: CachedDigestAuth | null = null;
  // Tracks the protocol+port that last successfully answered GET /system.
  // Lets refreshSystemMetadata skip the redundant verifyHttpsResponds probe
  // when getSystem already proved HTTPS works (and vice versa).
  private lastSystemTransport: { protocol: Protocol; port: number } | null = null;
  // Serializes outgoing HTTPS calls. Philips' Restlet HTTPS server force-closes
  // connections under load ("Restlet CPU Consumption bug" in the TV's own
  // logs); concurrent HTTPS requests fill the TV's accept-queue with sockets
  // it never releases, until the HTTPS server is functionally dead. HTTP/1925
  // (notifychange long-poll) is unaffected and stays unserialized.
  private httpsCallChain: Promise<unknown> = Promise.resolve();

  constructor(config: JointspaceConfig, options: JointspaceApiOptions = {}) {
    this.config = config;
    this.log = options.log ?? (() => undefined);
    this.debug = options.debug ?? false;
    // TVs use a self-signed cert; skip CA verification. No legacy-TLS
    // tweaks needed — the TLS handshake script confirms modern Philips
    // firmware negotiates TLS 1.2 with ECDHE-CHACHA20 just fine on Node's
    // default cipher set.
    // keepAlive + maxSockets: 1 makes axios reuse the same TCP/TLS connection
    // across requests. Critical for digest auth on this TV: needle (used by the
    // old JS app) did the 401-challenge + auth-retry over a single socket,
    // because Restlet appears to bind the digest nonce to the TCP session.
    // Two separate sockets => second request RSTs within 64ms. The HTTPS
    // mutex serializes outgoing calls so maxSockets: 1 is fine.
    this.httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 1 });
    this.anonClient = this.buildAnonClient();
    this.rebuildDigestClient();
  }

  static portForApiVersion(apiVersion: number): number {
    return apiVersion >= 6 ? HTTPS_PORT : HTTP_PORT;
  }

  static protocolForSecured(secured: boolean): Protocol {
    return secured ? "https" : "http";
  }

  static generateDeviceId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  updateConfig(patch: Partial<JointspaceConfig>): void {
    this.config = { ...this.config, ...patch };
    this.anonClient = this.buildAnonClient();
    this.rebuildDigestClient();
  }

  setCredentials(credentials: JointspaceCredentials | undefined): void {
    this.config = { ...this.config, credentials };
    this.rebuildDigestClient();
  }

  isPaired(): boolean {
    return Boolean(this.config.credentials?.user && this.config.credentials?.pass);
  }

  // --- public API -------------------------------------------------------

  /**
   * Most TVs expose system info on HTTP/1925 unauthenticated, even Android
   * models. Some sets (e.g. 43PUS8546, reported in PR #41) return HTTP 200
   * with an empty body on /1925/system and only serve real data on
   * HTTPS/1926/system. Try the standard endpoint first, fall back to the
   * secured one when the body parses to nothing useful.
   *
   * The "nothing useful" check is `api_version.Major` because both empty
   * strings and HTML "Ok" sentinels are normalised to `{}` by parseResponse
   * upstream - the only reliable signal that we got real system info is the
   * presence of an api version.
   */
  async getSystem(): Promise<SystemInfo> {
    const primary = await this.probeSystemHttp();
    if (primary?.api_version?.Major) {
      this.lastSystemTransport = { protocol: "http", port: HTTP_PORT };
      return primary;
    }

    this.log("HTTP/1925/system returned empty body, falling back to HTTPS/1926");
    const fallback = await this.probeSystemHttps();
    if (fallback?.api_version?.Major) {
      this.lastSystemTransport = { protocol: "https", port: HTTPS_PORT };
      return fallback;
    }

    throw new InvalidResponseError("System endpoint returned no api_version on either HTTP/1925 or HTTPS/1926");
  }

  /**
   * Returns the protocol+port that last successfully served GET /system,
   * or null if no successful system probe has happened yet. Callers can use
   * this to skip a redundant HTTPS verify probe when getSystem just proved
   * which transport works.
   */
  getLastSystemTransport(): { protocol: Protocol; port: number } | null {
    return this.lastSystemTransport;
  }

  /** Raw GET /system on HTTP/1925, unauthenticated. Exposed for diagnostics. */
  async probeSystemHttp(): Promise<SystemInfo> {
    return this.request<SystemInfo>({
      method: "GET",
      path: "system",
      port: HTTP_PORT,
      protocol: "http",
      prefixApiVersion: false,
      requireAuth: false,
    });
  }

  /** Raw GET /system on HTTPS/1926, unauthenticated. Exposed for diagnostics. */
  async probeSystemHttps(): Promise<SystemInfo> {
    return this.request<SystemInfo>({
      method: "GET",
      path: "system",
      port: HTTPS_PORT,
      protocol: "https",
      prefixApiVersion: false,
      requireAuth: false,
    });
  }

  /**
   * Probe whether HTTPS/1926 actually responds with a valid system payload.
   * Some Philips firmwares advertise secured_transport=true but leave the
   * HTTPS server unresponsive on the active network interface; the rest of
   * our API then hangs forever waiting on it. Callers use this to confirm
   * the advertised transport before trusting it.
   */
  async verifyHttpsResponds(timeoutMs = 6000): Promise<boolean> {
    try {
      const response = await Promise.race([
        this.probeSystemHttps(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`HTTPS verification timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return Boolean(response?.api_version?.Major);
    } catch {
      return false;
    }
  }

  async startPair(device: PairDevice): Promise<PairingState> {
    const response = await this.request<PairRequestResponse>({
      method: "POST",
      path: "pair/request",
      data: {
        access: { scope: ["read", "write", "control"] },
        device,
      },
      requireAuth: false,
    });

    if (response.error_id !== PairingStatus.Success) {
      throw new PairingError(
        `pair/request rejected: ${response.error_id}`,
        response.error_id,
        response.error_text,
      );
    }

    return {
      device,
      authKey: response.auth_key,
      timestamp: response.timestamp,
    };
  }

  async confirmPair(state: PairingState, pin: string): Promise<JointspaceCredentials> {
    const credentials: JointspaceCredentials = { user: state.device.id, pass: state.authKey };
    const signature = JointspaceApi.hmacSignature(PAIR_SHARED_KEY, String(state.timestamp), pin);
    const data = {
      device: state.device,
      auth: {
        auth_AppId: "1",
        pin,
        auth_timestamp: state.timestamp,
        auth_signature: signature,
      },
    };

    const response = await this.requestWithCredentials<PairGrantResponse>(
      {
        method: "POST",
        path: "pair/grant",
        data,
        requireAuth: true,
      },
      credentials,
    );

    if (response.error_id !== PairingStatus.Success) {
      throw new PairingError(
        `pair/grant rejected: ${response.error_id}`,
        response.error_id,
        response.error_text,
      );
    }

    this.setCredentials(credentials);
    return credentials;
  }

  async getApplications(): Promise<Application[]> {
    const response = await this.request<ApplicationsResponse>({ method: "GET", path: "applications" });
    return response.applications ?? [];
  }

  async sendKey(key: string): Promise<void> {
    await this.request<unknown>({ method: "POST", path: "input/key", data: { key } });
  }

  async launchActivity(intent: ApplicationIntent): Promise<void> {
    await this.request<unknown>({ method: "POST", path: "activities/launch", data: { intent } });
  }

  async getPowerState(): Promise<PowerState> {
    return this.request<PowerState>({ method: "GET", path: "powerstate" });
  }

  async setPowerState(on: boolean): Promise<void> {
    if (!on) {
      await this.request<unknown>({ method: "POST", path: "powerstate", data: { powerstate: "Standby" } });
      return;
    }
    try {
      await this.request<unknown>({ method: "POST", path: "powerstate", data: { powerstate: "On" } });
      return;
    } catch (err) {
      // Older Homey releases (<= 2.x) relied on POSTing to apps/ChromeCast
      // on port 8008 as a wake trick. ha-philipsjs and pylips both prefer
      // the standard endpoint above. Keep ChromeCast as a last-resort
      // fallback for TVs that don't honour the standard call.
      if (this.debug) this.log("powerstate=On failed, trying ChromeCast fallback:", err);
      await this.request<unknown>({
        method: "POST",
        path: "apps/ChromeCast",
        data: {},
        port: 8008,
        protocol: "http",
        prefixApiVersion: false,
        requireAuth: false,
      });
    }
  }

  async getScreenState(): Promise<ScreenState> {
    return this.request<ScreenState>({ method: "GET", path: "screenstate" });
  }

  async setScreenState(state: "On" | "Off"): Promise<void> {
    await this.request<unknown>({ method: "POST", path: "screenstate", data: { screenstate: state } });
  }

  async getAudioData(): Promise<AudioData> {
    return this.request<AudioData>({ method: "GET", path: "audio/volume" });
  }

  async setVolume(level: number, muted = false): Promise<void> {
    await this.request<unknown>({
      method: "POST",
      path: "audio/volume",
      data: { current: level, muted },
    });
  }

  async getAmbilight(): Promise<AmbilightConfiguration> {
    return this.request<AmbilightConfiguration>({ method: "GET", path: "ambilight/currentconfiguration" });
  }

  async setAmbilight(on: boolean): Promise<void> {
    await this.request<unknown>({
      method: "POST",
      path: "ambilight/power",
      data: { power: on ? "On" : "Off" },
    });
    if (!on) {
      // MSAF (Android XTV) firmware sometimes acks ambilight/power but doesn't
      // actuate the off command. Posting an "OFF" style to the configuration
      // endpoint forces the TV to apply it.
      await this.request<unknown>({
        method: "POST",
        path: "ambilight/currentconfiguration",
        data: { styleName: "OFF", isExpert: false },
      }).catch((err) => {
        if (this.debug) this.log("ambilight off backstop failed:", err);
      });
    }
  }

  async setAmbilightConfiguration(config: AmbilightConfiguration): Promise<void> {
    await this.request<unknown>({ method: "POST", path: "ambilight/currentconfiguration", data: config });
  }

  async getAmbiHue(): Promise<AmbiHueState> {
    return this.request<AmbiHueState>({ method: "GET", path: "HueLamp/power" });
  }

  async setAmbiHue(on: boolean): Promise<void> {
    await this.request<unknown>({
      method: "POST",
      path: "HueLamp/power",
      data: { power: on ? "On" : "Off" },
    });
  }

  async setSetting(setting: MenuItemsSettingUpdate): Promise<void> {
    await this.request<unknown>({ method: "POST", path: "menuitems/settings/update", data: setting });
  }

  // --- channels --------------------------------------------------------

  async getChannelLists(): Promise<ChannelDbTv> {
    return this.request<ChannelDbTv>({ method: "GET", path: "channeldb/tv" });
  }

  async getChannelList(listId = "alltv"): Promise<ChannelList> {
    return this.request<ChannelList>({ method: "GET", path: `channeldb/tv/channelLists/${encodeURIComponent(listId)}` });
  }

  async getLegacyChannels(): Promise<LegacyChannels> {
    return this.request<LegacyChannels>({ method: "GET", path: "channels" });
  }

  async setChannel(ccid: number | string, listId = "alltv"): Promise<void> {
    if (this.config.apiVersion >= 5) {
      await this.request<unknown>({
        method: "POST",
        path: "activities/tv",
        data: {
          channel: { ccid: typeof ccid === "string" ? Number(ccid) || ccid : ccid },
          channelList: { id: listId, version: "" },
        },
      });
      return;
    }
    await this.request<unknown>({
      method: "POST",
      path: "channels/current",
      data: { id: typeof ccid === "string" ? ccid : String(ccid) },
    });
  }

  // --- sources ---------------------------------------------------------

  async getSources(): Promise<SourcesMap> {
    return this.request<SourcesMap>({ method: "GET", path: "sources" });
  }

  async getCurrentSource(): Promise<CurrentSource> {
    return this.request<CurrentSource>({ method: "GET", path: "sources/current" });
  }

  async setSource(id: string): Promise<void> {
    await this.request<unknown>({
      method: "POST",
      path: "sources/current",
      data: { id },
    });
  }

  /**
   * Long-polling endpoint. Some models hold the connection until the next
   * state change, others close after a fixed window. We use a 130s read
   * timeout matching the ha-philipsjs convention.
   */
  async notifyChange(lastState?: NotifyChangeState): Promise<NotifyChangeState | null> {
    const payload: NotifyChangePayload = lastState && Object.keys(lastState).length > 0
      ? { notification: lastState }
      : this.buildInitialNotifyPayload();

    return this.request<NotifyChangeState>({
      method: "POST",
      path: "notifychange",
      data: payload,
      port: HTTP_PORT,
      protocol: "http",
      timeoutMs: NOTIFY_CHANGE_TIMEOUT_MS,
    });
  }

  getPossibleKeys(): InputKeyDescriptor[] {
    return allPossibleInputs as InputKeyDescriptor[];
  }

  // --- internals --------------------------------------------------------

  private buildAnonClient(): AxiosInstance {
    return axios.create({
      timeout: DEFAULT_TIMEOUT_MS,
      httpsAgent: this.httpsAgent,
      validateStatus: () => true,
    });
  }

  private rebuildDigestClient(): void {
    const credentials = this.config.credentials;
    if (!credentials?.user || !credentials?.pass) {
      this.digestClient = null;
      return;
    }
    this.digestClient = new CachedDigestAuth({
      username: credentials.user,
      password: credentials.pass,
      axios: this.anonClient,
    });
  }

  private buildUrl(path: string, port: number, protocol: Protocol, prefixApiVersion: boolean): string {
    const prefixed = prefixApiVersion ? `${this.config.apiVersion}/${path}` : path;
    return `${protocol}://${this.config.host}:${port}/${prefixed}`;
  }

  private async request<T>(opts: RequestOptions): Promise<T> {
    return this.requestWithCredentials<T>(opts, this.config.credentials);
  }

  private async requestWithCredentials<T>(
    opts: RequestOptions,
    credentials?: JointspaceCredentials,
  ): Promise<T> {
    const protocol = opts.protocol ?? (this.config.secured ? "https" : "http");
    const port = opts.port ?? this.config.port ?? JointspaceApi.portForApiVersion(this.config.apiVersion);
    const url = this.buildUrl(opts.path, port, protocol, opts.prefixApiVersion ?? true);

    const requestConfig: AxiosRequestConfig = {
      method: opts.method,
      url,
      data: opts.data,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      httpsAgent: this.httpsAgent,
      // No explicit Connection header. Letting keep-alive run means axios
      // can recycle the same socket for the digest auth 401-challenge +
      // auth-retry handshake. Forcing Connection: close (as a previous
      // attempt at the Restlet "CPU consumption bug" workaround) made the
      // TV RST every second digest request within 64ms.
      headers: { Accept: "application/json" },
      validateStatus: () => true,
    };

    const startedAt = Date.now();
    if (this.debug) this.log("→", opts.method, url);

    const exec = async (): Promise<T> => {
      try {
        const response = await this.sendWithRetry(requestConfig, opts, credentials);
        if (this.debug) this.log("←", response.status, opts.method, url, `(${Date.now() - startedAt}ms)`);
        return this.parseResponse<T>(response);
      } catch (err) {
        const code = (err as AxiosError | NodeJS.ErrnoException).code ?? (err as Error).name;
        // Errors always logged — the failure code is genuinely useful and
        // not noisy. Successful requests are gated behind `debug`.
        this.log("✗", code, opts.method, url, `(${Date.now() - startedAt}ms)`);
        throw err;
      }
    };

    if (protocol === "https") return this.serializeHttps(exec);
    return exec();
  }

  private serializeHttps<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.httpsCallChain;
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    this.httpsCallChain = slot;
    const run = async (): Promise<T> => {
      // Swallow upstream rejection so one HTTPS failure doesn't poison
      // every subsequent call in the chain.
      await previous.catch(() => undefined);
      try {
        return await fn();
      } finally {
        release();
      }
    };
    return run();
  }

  private async sendWithRetry(
    requestConfig: AxiosRequestConfig,
    opts: RequestOptions,
    credentials?: JointspaceCredentials,
  ): Promise<AxiosResponse> {
    const send = (): Promise<AxiosResponse> => this.sendOnce(requestConfig, opts, credentials);
    try {
      return await send();
    } catch (err) {
      if (this.isRetryableProtocolError(err)) {
        this.log(`Retrying after ${(err as Error).message} on ${opts.method} ${requestConfig.url}`);
        try {
          return await send();
        } catch (retryErr) {
          throw this.wrapTransportError(retryErr);
        }
      }
      throw this.wrapTransportError(err);
    }
  }

  private async sendOnce(
    requestConfig: AxiosRequestConfig,
    opts: RequestOptions,
    credentials?: JointspaceCredentials,
  ): Promise<AxiosResponse> {
    if (opts.requireAuth !== false && credentials?.user && credentials?.pass) {
      const digest = credentials === this.config.credentials
        ? this.digestClient
        : new CachedDigestAuth({
            username: credentials.user,
            password: credentials.pass,
            axios: this.anonClient,
          });
      if (digest) return digest.request(requestConfig);
    }
    return this.anonClient.request(requestConfig);
  }

  private parseResponse<T>(response: AxiosResponse): T {
    if (response.status === 401) throw new UnauthenticatedError();
    if (response.status === 404) throw new NotFoundError();
    if (response.status >= 400) {
      throw new JointspaceError(`HTTP ${response.status}: ${this.responseSummary(response)}`, response.status);
    }

    const contentType = String(response.headers["content-type"] ?? "");
    const text = typeof response.data === "string" ? response.data : "";

    if (response.data && typeof response.data === "object") {
      return response.data as T;
    }

    if (IGNORED_NON_JSON_RESPONSES.has(text.trim())) {
      return {} as T;
    }

    if (!contentType.includes("application/json")) {
      if (this.debug) this.log("Non-JSON response:", text);
      return {} as T;
    }

    try {
      return JSON.parse(JointspaceApi.repairBrokenJson(text)) as T;
    } catch (err) {
      throw new InvalidResponseError(`Failed to parse JSON: ${(err as Error).message}`);
    }
  }

  private responseSummary(response: AxiosResponse): string {
    if (typeof response.data === "string") return response.data.slice(0, 200);
    try {
      return JSON.stringify(response.data).slice(0, 200);
    } catch {
      return "<unserialisable>";
    }
  }

  private isRetryableProtocolError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const code = (err as AxiosError).code;
    return code === "ECONNRESET" || code === "ERR_BAD_RESPONSE";
  }

  private wrapTransportError(err: unknown): Error {
    if (err instanceof JointspaceError) return err;
    const axiosErr = err as AxiosError;
    const code = axiosErr.code;
    if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
      return new OfflineError(`TV unreachable (${code})`);
    }
    if (code === "ETIMEDOUT" || code === "ECONNABORTED") {
      return new OfflineError("TV connection timed out");
    }
    if (code === "ECONNRESET") {
      return new ProtocolError("Connection reset by TV");
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private buildInitialNotifyPayload(): NotifyChangePayload {
    const cloned = structuredClone(initialNotifyState) as NotifyChangePayload;
    const companion = (cloned.notification as { companionlauncher?: { device_id?: string } })
      .companionlauncher;
    const deviceId = this.config.credentials?.user ?? JointspaceApi.generateDeviceId();
    if (companion) companion.device_id = deviceId;
    return cloned;
  }

  private static hmacSignature(key: Buffer, timestamp: string, pin: string): string {
    return crypto.createHmac("sha1", key).update(timestamp).update(pin).digest("base64");
  }

  private static repairBrokenJson(text: string): string {
    let s = text.replace(/{\s*,/g, "{").replace(/,\s*}/g, "}");
    while (s.includes(",,")) s = s.replace(/,,/g, ",");
    return s;
  }
}
