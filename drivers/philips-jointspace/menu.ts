// The TV's settings menu (menuitems/settings/*): which options this TV offers and how to set them.

export interface MenuEnum {
  enum_id: number;
  string_id: string;
}

export interface MenuNode {
  node_id: number;
  type: string;
  context?: string;
  string_id?: string;
  data?: {
    nodes?: MenuNode[];
    enums?: MenuEnum[];
    [key: string]: unknown;
  };
}

export interface MenuStructure {
  node: MenuNode;
}

export interface MenuCurrentValue {
  Nodeid: number;
  Controllable?: boolean | string;
  Available?: boolean | string;
  string_id?: string;
  data?: {
    selected_item?: number;
    activenode_id?: number;
    value?: unknown;
    enum_values?: Array<MenuEnum & { available?: boolean; controllable?: boolean }>;
  };
}

export interface MenuCurrentResponse {
  values?: Array<{ value: MenuCurrentValue }>;
  version?: number;
}

/** One selectable value, addressed by the list node it lives in and its enum id. */
export interface MenuOption {
  id: string;
  nodeId: number;
  enumId: number;
  // Shown when the capability manifest has no title for `id`.
  fallbackTitle: string;
}

export interface MenuListCapability {
  nodeId: number;
  options: MenuOption[];
}

export interface AmbilightMenuCapability {
  styleNodeId: number;
  offNodeId: number | null;
  // list node id -> its context, for the style groups (follow video/audio/colour)
  groups: Record<number, string>;
  options: MenuOption[];
}

export interface MenuCapabilities {
  pictureStyle: MenuListCapability | null;
  ambilight: AmbilightMenuCapability | null;
}

export const AMBILIGHT_OFF = "off";

// Menu option -> existing ambilight_mode id, so flows keep working. Mapped on a 49PUS6412
// by selecting each option in the menu and reading ambilight/currentconfiguration.
const AMBILIGHT_MODE_IDS: Record<string, Record<string, string>> = {
  ambilight_follow_video: {
    MAIN_AMBILIGHT_STANDARD: "video_standard",
    MAIN_AMBILIGHT_NATURAL: "video_natural",
    MAIN_AMBILIGHT_FOOTBALL: "video_immersive",
    MAIN_AMBILIGHT_VIVID: "video_vivid",
    MAIN_AMBILIGHT_GAME: "video_game",
    MAIN_AMBILIGHT_COMFORT: "video_comfort",
    MAIN_AMBILIGHT_RELAX: "video_relax",
  },
  ambilight_follow_audio: {
    MAIN_FOLLOW_AUDIO_STYLE_1: "audio_adapt_brightness",
    MAIN_FOLLOW_AUDIO_STYLE_2: "audio_adapt_colors",
    MAIN_FOLLOW_AUDIO_STYLE_3: "audio_vu_meter",
    MAIN_FOLLOW_AUDIO_STYLE_4: "audio_spectrum",
    MAIN_FOLLOW_AUDIO_STYLE_5: "audio_knight_rider_2",
    MAIN_FOLLOW_AUDIO_STYLE_6: "audio_flash",
    MAIN_FOLLOW_AUDIO_STYLE_7: "audio_random",
  },
  ambilight_follow_color: {
    MAIN_LOUNGE_LIGHT_MODE_1: "color_fresh_nature",
    MAIN_LOUNGE_LIGHT_MODE_2: "color_hot_lava",
    MAIN_LOUNGE_LIGHT_MODE_3: "color_deep_water",
    MAIN_WARM_WHITE: "color_warm_white",
    MAIN_COOL_WHITE: "color_cool_white",
  },
};

const AMBILIGHT_GROUP_PREFIX: Record<string, string> = {
  ambilight_follow_video: "video",
  ambilight_follow_audio: "audio",
  ambilight_follow_color: "color",
};

export function flattenMenu(root: MenuNode): MenuNode[] {
  const out: MenuNode[] = [];
  const visit = (node: MenuNode) => {
    out.push(node);
    for (const child of node.data?.nodes ?? []) visit(child);
  };
  visit(root);
  return out;
}

export function findMenuNode(root: MenuNode, context: string): MenuNode | undefined {
  return flattenMenu(root).find((n) => n.context === context);
}

/** `org.droidtv.ui.strings.R.string.MAIN_HDR_VIVID` -> `MAIN_HDR_VIVID` */
export function menuResourceKey(stringId: string): string {
  const dot = stringId.lastIndexOf(".");
  return dot >= 0 ? stringId.slice(dot + 1) : stringId;
}

/** `MAIN_HDR_VIVID` -> `hdr_vivid` */
export function menuOptionId(key: string): string {
  return key.replace(/^MAIN_/, "").replace(/^AMBILIGHT_/, "").toLowerCase();
}

const UPPERCASE_WORDS = new Set(["hdr", "isf", "ai", "tv", "pc"]);

/** `MAIN_HDR_VIVID` -> `HDR Vivid` */
export function humanizeMenuKey(key: string): string {
  return menuOptionId(key)
    .split("_")
    .filter(Boolean)
    .map((w) => (UPPERCASE_WORDS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function listOptions(node: MenuNode, idFor: (key: string) => string): MenuOption[] {
  const seen = new Set<string>();
  const options: MenuOption[] = [];
  for (const e of node.data?.enums ?? []) {
    const key = menuResourceKey(e.string_id);
    const id = idFor(key);
    // Some lists repeat a label under a second enum id (e.g. Vivid as 4 and 8); keep the first.
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ id, nodeId: node.node_id, enumId: e.enum_id, fallbackTitle: humanizeMenuKey(key) });
  }
  return options;
}

export function extractMenuCapabilities(structure: MenuStructure | null | undefined): MenuCapabilities {
  const root = structure?.node;
  if (!root) return { pictureStyle: null, ambilight: null };

  const pictureNode = findMenuNode(root, "picture_style");
  const pictureStyle = pictureNode?.type === "LIST_NODE"
    ? { nodeId: pictureNode.node_id, options: listOptions(pictureNode, menuOptionId) }
    : null;

  let ambilight: AmbilightMenuCapability | null = null;
  const styleNode = findMenuNode(root, "ambilight_style");
  if (styleNode) {
    const children = styleNode.data?.nodes ?? [];
    const offNode = children.find((n) => n.context === "ambilight_off");
    const groups: Record<number, string> = {};
    const options: MenuOption[] = [];
    if (offNode) {
      options.push({ id: AMBILIGHT_OFF, nodeId: offNode.node_id, enumId: -1, fallbackTitle: "Off" });
    }
    for (const child of children) {
      if (child.type !== "LIST_NODE" || !child.context) continue;
      groups[child.node_id] = child.context;
      const known = AMBILIGHT_MODE_IDS[child.context] ?? {};
      const prefix = AMBILIGHT_GROUP_PREFIX[child.context] ?? child.context.replace(/^ambilight_/, "");
      options.push(...listOptions(child, (key) => known[key] ?? `${prefix}_${menuOptionId(key).replace(/^follow_audio_/, "")}`));
    }
    if (options.length > 0) {
      ambilight = { styleNodeId: styleNode.node_id, offNodeId: offNode?.node_id ?? null, groups, options };
    }
  }

  return { pictureStyle, ambilight };
}

function valueOf(response: MenuCurrentResponse | null | undefined, nodeId: number): MenuCurrentValue | undefined {
  return response?.values?.find((v) => v.value?.Nodeid === nodeId)?.value;
}

export function currentPictureStyle(capability: MenuListCapability, response: MenuCurrentResponse): string | null {
  const selected = valueOf(response, capability.nodeId)?.data?.selected_item;
  if (selected == null) return null;
  return capability.options.find((o) => o.enumId === selected)?.id ?? null;
}

export function currentAmbilightMode(capability: AmbilightMenuCapability, response: MenuCurrentResponse): string | null {
  const active = valueOf(response, capability.styleNodeId)?.data?.activenode_id;
  if (active == null) return null;
  if (active === capability.offNodeId) return AMBILIGHT_OFF;
  if (!(active in capability.groups)) return null;
  const selected = valueOf(response, active)?.data?.selected_item;
  if (selected == null) return null;
  return capability.options.find((o) => o.nodeId === active && o.enumId === selected)?.id ?? null;
}

/** The options the TV allows right now: HDR picture styles, for example, only while HDR content plays. */
export function availableOptions(options: MenuOption[], response: MenuCurrentResponse): MenuOption[] {
  return options.filter((o) => {
    if (o.enumId < 0) return true;
    const entry = valueOf(response, o.nodeId)?.data?.enum_values?.find((e) => e.enum_id === o.enumId);
    return entry?.available !== false;
  });
}

/** Node ids to ask menuitems/settings/current for, to read every dynamic capability. */
export function menuNodesToRead(capabilities: MenuCapabilities): number[] {
  const ids = new Set<number>();
  if (capabilities.pictureStyle) ids.add(capabilities.pictureStyle.nodeId);
  if (capabilities.ambilight) {
    ids.add(capabilities.ambilight.styleNodeId);
    for (const id of Object.keys(capabilities.ambilight.groups)) ids.add(Number(id));
  }
  return [...ids];
}

/** One line per node, for the diagnostic report. */
export function describeMenuTree(root: MenuNode): string[] {
  const lines: string[] = [];
  const visit = (node: MenuNode, depth: number) => {
    const enums = node.data?.enums?.map((e) => `${e.enum_id}=${menuResourceKey(e.string_id)}`).join(", ");
    const slider = node.data?.slider_data ? ` ${JSON.stringify(node.data.slider_data)}` : "";
    lines.push(`${"  ".repeat(depth)}${node.node_id} ${node.type} ${node.context ?? "-"}${enums ? ` [${enums}]` : ""}${slider}`);
    for (const child of node.data?.nodes ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines;
}
