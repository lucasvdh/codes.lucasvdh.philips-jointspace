// In-memory only: lets a diagnostic report show what happened during the last pairing attempt or flow failure.

export interface ActivityEntry {
  at: string;
  scope: string;
  message: string;
}

const MAX_ENTRIES = 400;
const MAX_MESSAGE_LENGTH = 500;

export class ActivityLog {
  private entries: ActivityEntry[] = [];

  constructor(private readonly maxEntries = MAX_ENTRIES) {}

  add(scope: string, ...args: unknown[]): void {
    const message = args.map(formatArg).join(" ");
    this.entries.push({
      at: new Date().toISOString(),
      scope,
      message: message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message,
    });
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
  }

  list(scope?: string): ActivityEntry[] {
    return scope ? this.entries.filter((e) => e.scope === scope) : [...this.entries];
  }
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    const statusCode = (arg as Error & { statusCode?: number }).statusCode;
    return `${arg.name}${statusCode ? ` (${statusCode})` : ""}: ${arg.message}`;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export const PAIRING_SCOPE = "pairing";
export const deviceScope = (deviceId: string) => `device:${deviceId}`;

export const activityLog = new ActivityLog();
