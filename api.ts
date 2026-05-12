import { generateDeviceReport, renderMarkdown, DiscoverySnapshot, NetworkSnapshot } from "./drivers/philips-jointspace/diagnostic";

const DRIVER_ID = "philips-jointspace";

interface ApiArgs {
  homey: any;
}

interface ReportArgs extends ApiArgs {
  body: { deviceId: string };
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
};

async function collectNetwork(homey: any, device: any): Promise<NetworkSnapshot | undefined> {
  const settings = device.getSettings?.() ?? {};
  const ip: string | undefined = settings.ipAddress;
  if (!ip) return undefined;
  try {
    const mac = await homey.arp.getMAC(ip);
    return { ip, arpMac: typeof mac === "string" && mac.length > 0 ? mac : undefined };
  } catch (err) {
    return { ip, arpError: (err as Error).message };
  }
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
