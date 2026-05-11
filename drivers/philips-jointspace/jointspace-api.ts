import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from "axios";
import AxiosDigestAuth from "@mhoc/axios-digest-auth";
import * as crypto from "crypto";
import * as https from "https";

import {
  AmbilightConfiguration,
  AmbiHueState,
  Application,
  ApplicationIntent,
  ApplicationsResponse,
  AudioData,
  InputKeyDescriptor,
  JointspaceConfig,
  JointspaceCredentials,
  MenuItemsSettingUpdate,
  NotifyChangePayload,
  NotifyChangeState,
  PairDevice,
  PairGrantResponse,
  PairingState,
  PairRequestResponse,
  PowerState,
  Protocol,
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

const DEFAULT_TIMEOUT_MS = 20_000;
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
  private digestClient: AxiosDigestAuth | null = null;

  constructor(config: JointspaceConfig, options: JointspaceApiOptions = {}) {
    this.config = config;
    this.log = options.log ?? (() => undefined);
    this.debug = options.debug ?? false;
    this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
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
   * System info is always exposed on HTTP/1925 even on Android TVs; some
   * models will not serve it over the secured transport.
   */
  async getSystem(): Promise<SystemInfo> {
    return this.request<SystemInfo>({
      method: "GET",
      path: "system",
      port: HTTP_PORT,
      protocol: "http",
      prefixApiVersion: false,
      requireAuth: false,
    });
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
    this.digestClient = new AxiosDigestAuth({
      username: credentials.user,
      password: credentials.pass,
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
      headers: { Accept: "application/json" },
      validateStatus: () => true,
    };

    if (this.debug) this.log("→", opts.method, url);

    const response = await this.sendWithRetry(requestConfig, opts, credentials);
    return this.parseResponse<T>(response);
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
        if (this.debug) this.log("Retrying once after protocol error:", (err as Error).message);
        return send();
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
        : new AxiosDigestAuth({ username: credentials.user, password: credentials.pass });
      if (digest) {
        return digest.request(requestConfig as never) as unknown as AxiosResponse;
      }
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
