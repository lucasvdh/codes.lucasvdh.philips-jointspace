// Decisions behind the device's optional capabilities, kept free of Homey so they can be tested.
import type { MenuSlider } from "./menu";

/** Which optional capabilities to add or remove, given what /system says the TV has (null: unknown, leave it). */
export function featureCapabilityChanges(
  features: Record<string, boolean | null>,
  has: (capabilityId: string) => boolean,
): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const [capabilityId, supported] of Object.entries(features)) {
    if (supported === false && has(capabilityId)) remove.push(capabilityId);
    else if (supported === true && !has(capabilityId)) add.push(capabilityId);
  }
  return { add, remove };
}

/** Rounds to the slider's step and clamps to its range. */
export function snapSliderValue(slider: MenuSlider, value: number): number {
  const rounded = Math.round(value / slider.step) * slider.step;
  return Math.min(Math.max(rounded, slider.min), slider.max);
}

/**
 * The Ambilight mode to take from an ambilight/currentconfiguration poll.
 * - With the menu, the menu poll owns the mode; this poll sets nothing.
 * - On firmware with the mode quirk, a mode Homey set (cached) wins until the TV reports it.
 */
export function ambilightModeFromConfigPoll(opts: {
  menuHasAmbilight: boolean;
  reported: string | undefined;
  cached: string | null;
  osHasQuirk: boolean;
}): { mode: string | undefined; clearCache: boolean } {
  if (opts.menuHasAmbilight) return { mode: undefined, clearCache: false };
  if (!opts.osHasQuirk || !opts.cached) return { mode: opts.reported, clearCache: false };
  if (opts.reported === opts.cached) return { mode: opts.reported, clearCache: true };
  return { mode: opts.cached, clearCache: false };
}
