import {
  generateDeviceReport,
  generateIpReport,
  renderMarkdown,
  DiscoverySnapshot,
  NetworkSnapshot,
} from "./drivers/philips-jointspace/diagnostic";
import { JointspaceApi } from "./drivers/philips-jointspace/jointspace-api";

const DRIVER_ID = "philips-jointspace";

interface ApiArgs {
  homey: any;
}

interface ReportArgs extends ApiArgs {
  body: { deviceId: string };
}

interface ProbeIpArgs extends ApiArgs {
  body: { ip: string };
}

interface DeviceLite {
  getName(): string;
  getData(): { id?: string } & Record<string, unknown>;
  getJointspaceClient?: () => unknown;
}

module.exports = {
  async listDevices({ homey }: ApiArgs): Promise<Array<{ id: string; name: string }>> {
    const driver = homey.drivers.getDriver(DRIVER_ID);
    return driver.getDevices().map((d: DeviceLite) => ({
      id: String(d.getData().id ?? d.getName()),
      name: d.getName(),
    }));
  },

  async generateReport({ homey, body }: ReportArgs): Promise<{ markdown: string }> {
    const driver = homey.drivers.getDriver(DRIVER_ID);
    const device = driver
      .getDevices()
      .find((d: DeviceLite) => String(d.getData().id ?? "") === body.deviceId);
    if (!device) {
      throw new Error(`No paired device found with id ${body.deviceId}`);
    }
    if (typeof device.getJointspaceClient !== "function") {
      throw new Error(`Device ${body.deviceId} does not expose getJointspaceClient`);
    }

    const report = await generateDeviceReport({
      device,
      api: device.getJointspaceClient(),
      appVersion: String(homey.manifest?.version ?? "unknown"),
      homeyFirmwareVersion: typeof homey.version === "string" ? homey.version : undefined,
      homeyPlatform: typeof homey.platform === "string" ? homey.platform : undefined,
      discovery: collectDiscovery(homey),
      network: await collectNetwork(homey, device),
    });

    return { markdown: renderMarkdown(report) };
  },

  async probeByIp({ homey, body }: ProbeIpArgs): Promise<{ markdown: string }> {
    const ip = String(body?.ip ?? "").trim();
    if (!ip) throw new Error("ip is required");
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`"${ip}" doesn't look like an IPv4 address`);

    const api = new JointspaceApi({ host: ip, apiVersion: 1, secured: false, port: 1925 });
    const report = await generateIpReport({
      ip,
      api,
      appVersion: String(homey.manifest?.version ?? "unknown"),
      homeyFirmwareVersion: typeof homey.version === "string" ? homey.version : undefined,
      homeyPlatform: typeof homey.platform === "string" ? homey.platform : undefined,
      network: await collectNetworkForIp(homey, ip),
      discovery: collectDiscovery(homey),
    });

    return { markdown: renderMarkdown(report) };
  },
};

async function collectNetworkForIp(homey: any, ip: string): Promise<NetworkSnapshot> {
  try {
    // Homey's arp.getMAC pings the host internally; on a host that isn't
    // already in the kernel ARP cache that ping can take 5s. Probes run in
    // parallel, so this 8s cap doesn't blow the 10s settings-api ceiling
    // as long as the probes themselves stay under ~4s each (they do).
    const mac = await Promise.race([
      homey.arp.getMAC(ip),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ARP lookup timed out after 8s")), 8000),
      ),
    ]);
    return { ip, arpMac: typeof mac === "string" && mac.length > 0 ? mac : undefined };
  } catch (err) {
    return { ip, arpError: humaniseArpError((err as Error).message) };
  }
}

async function collectNetwork(homey: any, device: any): Promise<NetworkSnapshot | undefined> {
  const settings = device.getSettings?.() ?? {};
  const ip: string | undefined = settings.ipAddress;
  if (!ip) return undefined;
  return collectNetworkForIp(homey, ip);
}

function humaniseArpError(message: string): string {
  if (message.includes("ping")) return "TV did not respond to ARP probe (likely powered off)";
  if (message.includes("timed out")) return "ARP lookup timed out";
  return message;
}

function collectDiscovery(homey: any): DiscoverySnapshot | undefined {
  try {
    const ssdp = homey.discovery.getStrategy("philips-tv-discovery").getDiscoveryResults();
    const mdns = homey.discovery.getStrategy("philips-tv-mdns").getDiscoveryResults();
    const ssdpArr = Object.values(ssdp) as Array<{ id: string; address: string }>;
    const mdnsArr = Object.values(mdns) as Array<{ id: string; address: string; name?: string }>;
    return {
      ssdpResults: ssdpArr.length,
      mdnsResults: mdnsArr.length,
      ssdpSample: ssdpArr.slice(0, 5).map((r) => ({ id: r.id, address: r.address })),
      mdnsSample: mdnsArr.slice(0, 5).map((r) => ({ id: r.id, address: r.address, name: r.name })),
    };
  } catch {
    return undefined;
  }
}
