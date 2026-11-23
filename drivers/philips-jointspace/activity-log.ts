// In-memory only: lets a diagnostic report show what happened during the last pairing attempt or flow failure.

export interface ActivityEntry {
  at: string;
  scope: string;
  message: string;
}

// Per scope, so one chatty device can't push out another device's errors or the pairing log.
const MAX_ENTRIES_PER_SCOPE = 400;
const MAX_MESSAGE_LENGTH = 500;

export class ActivityLog {
  private entries: ActivityEntry[] = [];

  constructor(private readonly maxEntriesPerScope = MAX_ENTRIES_PER_SCOPE) {}

  add(scope: string, ...args: unknown[]): void {
    const message = args.map(formatArg).join(" ");
    this.entries.push({
      at: new Date().toISOString(),
      scope,
      message: message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message,
    });
    if (this.entries.filter((e) => e.scope === scope).length > this.maxEntriesPerScope) {
      this.entries.splice(this.entries.findIndex((e) => e.scope === scope), 1);
    }
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
// Commands and state changes, apart from errors so a busy volume slider can't push those out.
export const commandScope = (deviceId: string) => `commands:${deviceId}`;

export const activityLog = new ActivityLog();
