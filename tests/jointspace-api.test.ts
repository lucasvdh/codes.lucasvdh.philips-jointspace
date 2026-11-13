/**
 * Runs JointspaceApi against a fake TV on 127.0.0.1. getSystem() probes the
 * fixed JointSpace ports, so the fake listens on HTTP/1925 and nothing
 * listens on 1926 - which is exactly the "HTTPS refused" situation from
 * issues #61 and #67. Only the loopback interface is ever contacted.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { JointspaceApi } from "../drivers/philips-jointspace/jointspace-api";
import { PairingError } from "../drivers/philips-jointspace/errors";
import type { PairDevice } from "../drivers/philips-jointspace/types";

const HOST = "127.0.0.1";

type Handler = (req: http.IncomingMessage, body: string) => { status: number; json?: unknown; text?: string };
const routes = new Map<string, Handler>();
const seen: string[] = [];
let server: http.Server;

function route(method: string, path: string, handler: Handler): void {
  routes.set(`${method} ${path}`, handler);
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const key = `${req.method} ${req.url}`;
      seen.push(key);
      const handler = routes.get(key);
      const result = handler ? handler(req, body) : { status: 404, text: "Not Found" };
      if (result.json !== undefined) {
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.json));
      } else {
        res.writeHead(result.status, { "Content-Type": "text/html" });
        res.end(result.text ?? "");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(1925, HOST, () => resolve());
  });
  assert.equal((server.address() as AddressInfo).port, 1925);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const SAPHI_SYSTEM = {
  name: "50PUS8105/12",
  api_version: { Major: 6, Minor: 1, Patch: 0 },
  featuring: { systemfeatures: { secured_transport: "true", pairing_type: "digest_auth_pairing", os_type: "Linux" } },
};

const DEVICE: PairDevice = {
  app_id: "test",
  app_name: "test",
  device_name: "test",
  device_os: "test",
  id: "abcdef0123456789",
  type: "native",
};

test("getSystem falls through 403 /system to /1/system when 1926 refuses (issues #61, #67)", async () => {
  routes.clear();
  route("GET", "/system", () => ({ status: 403, text: "<html><head><title>Forbidden</title></head></html>" }));
  route("GET", "/1/system", () => ({ status: 200, json: SAPHI_SYSTEM }));

  const api = new JointspaceApi({ host: HOST, apiVersion: 1, secured: false, port: 1925 });
  const system = await api.getSystem();

  assert.equal(system.name, "50PUS8105/12");
  assert.deepEqual(api.getLastSystemTransport(), { protocol: "http", port: 1925 });
});

test("verifyHttpsResponds is false when nothing listens on 1926", async () => {
  const api = new JointspaceApi({ host: HOST, apiVersion: 6, secured: true, port: 1926 });
  assert.equal(await api.verifyHttpsResponds(2000), false);
});

test("startPair on the HTTP/1925 fallback posts to the versioned pair/request", async () => {
  routes.clear();
  let requestBody: unknown = null;
  route("POST", "/6/pair/request", (_req, body) => {
    requestBody = JSON.parse(body);
    return { status: 200, json: { error_id: "SUCCESS", auth_key: "secret", timestamp: 1234, timeout: 60 } };
  });

  const api = new JointspaceApi({ host: HOST, apiVersion: 6, secured: false, port: 1925 });
  const state = await api.startPair(DEVICE);

  assert.deepEqual(state, { device: DEVICE, authKey: "secret", timestamp: 1234 });
  assert.deepEqual((requestBody as { device: PairDevice }).device, DEVICE);
});

test("confirmPair surfaces the TV's error id and text", async () => {
  routes.clear();
  route("POST", "/6/pair/grant", () => ({
    status: 200,
    json: { error_id: "TIMEOUT", error_text: "Pairing request timed out" },
  }));

  const api = new JointspaceApi({ host: HOST, apiVersion: 6, secured: false, port: 1925 });
  await assert.rejects(
    api.confirmPair({ device: DEVICE, authKey: "secret", timestamp: 1234 }, "1234"),
    (err: unknown) => {
      assert.ok(err instanceof PairingError);
      assert.equal(err.errorId, "TIMEOUT");
      assert.equal(err.errorText, "Pairing request timed out");
      return true;
    },
  );
});

test("confirmPair succeeds and stores credentials", async () => {
  routes.clear();
  route("POST", "/6/pair/grant", () => ({ status: 200, json: { error_id: "SUCCESS" } }));

  const api = new JointspaceApi({ host: HOST, apiVersion: 6, secured: false, port: 1925 });
  const credentials = await api.confirmPair({ device: DEVICE, authKey: "secret", timestamp: 1234 }, "1234");

  assert.deepEqual(credentials, { user: DEVICE.id, pass: "secret" });
  assert.equal(api.isPaired(), true);
});
