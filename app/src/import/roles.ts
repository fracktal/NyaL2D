/**
 * Map arbitrary layer names (PSD layers and their groups, or PNG file names)
 * onto the auto-rig's roles (`@ikijs/editor` ROLE_TABLE).
 *
 * The auto-rig itself only accepts exact role names (`face.png`, `eye_L.png`,
 * …). Real layered illustrations are named however the artist (or tool) named
 * them, in any language, nested in groups, often several layers per feature
 * (line art, fill, shading). So each layer gets a role from its own name first
 * and then from its enclosing groups', by keyword; layers that share a role are
 * composited into one later. What no keyword names is decided by where it sits
 * in the stack relative to the face.
 *
 * Sources this is written against, besides Iki's own role names:
 * - See-Through (shitagaki-lab/see-through) PSD output: English body-part tags
 *   ("front hair", "irides", "eyewhite", "topwear", …), one layer per tag with
 *   both eyes in one layer.
 * - PSDTool-style 立ち絵 PSDs (坂本アヒル's ずんだもん etc.): Japanese names,
 *   nested groups, `*` radio variants and `!` always-on layers (handled by the
 *   PSD reader; names reach here with those prefixes).
 *
 * Side convention: `_L` is the character's left, which is the viewer's right
 * (higher x on the image), as in Live2D and the Iki samples.
 */

export type Side = "L" | "R";

/** Features that come as a pair; a layer without a side is split at the face's centre. */
const SIDED = new Set(["eye", "iris", "pupil", "highlight", "lash", "brow", "blush"]);

/**
 * Keyword table, most specific first: "속눈썹" (lash) has to win over "눈썹"
 * (brow), which has to win over "눈" (eye); "白目"/"黒目" over "目"; "顔色"
 * (blush) over "顔". Latin keywords match whole words or word runs (after
 * splitting on separators and camelCase); CJK keywords match as substrings.
 * `drop` marks a feature that has no place on the rig.
 */
const KEYWORDS: readonly { base: string; latin: string[]; cjk: string[] }[] = [
  { base: "hair_back", latin: ["hair_back", "hairback", "back_hair", "backhair", "rear_hair", "hair_b"], cjk: ["後ろ髪", "後髪", "うしろ髪", "后发", "뒷머리", "뒤머리"] },
  { base: "hair_front", latin: ["hair_front", "hairfront", "front_hair", "fronthair", "bangs", "bang", "fringe", "hair_f", "side_hair", "sidehair", "headwear", "hat", "ahoge"], cjk: ["前髪", "まえがみ", "刘海", "前发", "横髪", "サイド髪", "触角", "アホ毛", "帽子", "앞머리", "옆머리", "잔머리", "모자"] },
  { base: "highlight", latin: ["highlight", "hilight", "catchlight", "eye_light", "shine"], cjk: ["ハイライト", "高光", "하이라이트"] },
  { base: "pupil", latin: ["pupil", "pupils"], cjk: ["瞳孔", "동공"] },
  { base: "iris", latin: ["iris", "irises", "irides", "eyeball", "eye_ball"], cjk: ["黒目", "瞳", "虹彩", "眼球", "눈동자", "홍채", "검은자"] },
  { base: "lash", latin: ["lash", "lashes", "eyelash", "eyelashes", "eyeline", "eyeliner", "eyelid", "lid"], cjk: ["まつげ", "まつ毛", "睫毛", "睫", "アイライン", "まぶた", "瞼", "속눈썹", "아이라인", "눈꺼풀", "쌍꺼풀"] },
  { base: "brow", latin: ["brow", "brows", "eyebrow", "eyebrows", "mayu"], cjk: ["眉", "まゆ", "눈썹"] },
  { base: "blush", latin: ["blush", "cheek", "cheeks"], cjk: ["顔色", "頬", "ほっぺ", "チーク", "赤面", "照れ", "볼터치", "홍조"] },
  { base: "eye", latin: ["eye", "eyes", "eye_white", "eyewhite", "sclera"], cjk: ["白目", "目", "眼", "흰자", "눈"] },
  { base: "mouth", latin: ["mouth", "lip", "lips", "teeth", "tongue", "kuchi"], cjk: ["口", "唇", "歯", "舌", "くち", "입", "입술", "이빨", "치아", "혀"] },
  { base: "nose", latin: ["nose", "hana"], cjk: ["鼻", "코"] },
  { base: "face", latin: ["face", "skin", "head", "ear", "ears", "earwear", "earring", "kao"], cjk: ["顔", "頭", "輪郭", "肌", "耳", "かお", "얼굴", "피부", "귀", "윤곽"] },
  { base: "hair", latin: ["hair", "kami"], cjk: ["髪", "髮", "かみ", "头发", "머리카락", "헤어"] },
  { base: "body", latin: ["body", "torso", "neck", "neckwear", "topwear", "bottomwear", "legwear", "footwear", "handwear", "chest", "cloth", "clothes", "shirt", "arm", "arms", "hand", "hands", "leg", "legs", "shoulder", "uniform", "dress", "tail", "wings", "wing", "objects", "object"], cjk: ["体", "身体", "胴", "首", "服", "腕", "手", "足", "脚", "肩", "胸", "尻尾", "しっぽ", "翼", "몸", "몸통", "목", "옷", "팔", "손", "다리", "어깨", "가슴", "꼬리", "날개"] },
];

const L_WORDS = ["l", "left", "hidari"];
const R_WORDS = ["r", "right", "migi"];
const L_CJK = ["左", "왼", "좌"];
const R_CJK = ["右", "오른", "우측"];

/** Strip PSDTool markers (`*` radio, `!` forced, `:flipx` variants) and an extension. */
export function cleanName(name: string): string {
  return name.replace(/^[*!]+/, "").replace(/:flip[xy]+$/i, "").replace(/\.(png|webp|psd)$/i, "").trim();
}

function words(name: string): string[] {
  return cleanName(name)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The feature a single name names, without side, or undefined. */
export function featureOf(name: string): string | undefined {
  const w = words(name);
  const joined = `_${w.join("_")}_`;
  const raw = cleanName(name);
  for (const k of KEYWORDS) {
    for (const kw of k.latin) {
      if (kw.includes("_") ? joined.includes(`_${kw}_`) : w.includes(kw)) return k.base;
    }
    if (k.cjk.some((kw) => raw.includes(kw))) return k.base;
  }
  return undefined;
}

/** The side a single name names, or undefined. */
export function sideOf(name: string): Side | undefined {
  const w = words(name);
  if (w.some((x) => L_WORDS.includes(x))) return "L";
  if (w.some((x) => R_WORDS.includes(x))) return "R";
  const n = cleanName(name);
  // "eyeL", "browR": a capital side letter glued to a lower-case word.
  if (/[a-z]L$/.test(n)) return "L";
  if (/[a-z]R$/.test(n)) return "R";
  if (L_CJK.some((k) => n.includes(k))) return "L";
  if (R_CJK.some((k) => n.includes(k))) return "R";
  return undefined;
}

/** An exact auto-rig role name, as `@ikijs/editor`'s parseLayerRoles spells it. */
export function exactRole(name: string, roles: ReadonlySet<string>): string | undefined {
  const n = cleanName(name)
    .toLowerCase()
    .replace(/[-\s]+/g, "_")
    .replace(/_([lr])$/, (_, s: string) => `_${s.toUpperCase()}`);
  const alias: Record<string, string> = { eyebrow_L: "brow_L", eyebrow_R: "brow_R", eye_white_L: "eye_L", eye_white_R: "eye_R" };
  const r = alias[n] ?? n;
  return roles.has(r) ? r : undefined;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawLayerInfo {
  /** Group names outermost first, then the layer's own name. */
  path: string[];
  /** Stack index, 0 = bottom-most. */
  order: number;
  /** Opaque bounding box in canvas px, or null for an empty layer. */
  bbox: Box | null;
}

export type RoleAssignment =
  /** One role for the whole layer; null drops it. */
  | { kind: "role"; role: string | null; via: "name" | "keyword" | "position" }
  /** A both-sides layer (both eyes in one): split at canvas column `atX`;
   *  pixels at x ≥ atX go to `L` (the character's left), the rest to `R`. */
  | { kind: "split"; L: string; R: string; atX: number; via: "keyword" };

/**
 * Assign every layer a role. `roles` is the auto-rig's role table.
 *
 * 1. An exact role name on the layer or a group (`eye_L`, `hair_front`).
 * 2. A keyword on the layer, then on its groups innermost first. A paired
 *    feature takes its side from the same path; failing that, a layer wholly
 *    on one side of the face's centre takes that side, and one straddling it
 *    (both eyes drawn in one layer) is split there.
 * 3. Otherwise by stack position: in front of the face and inside its box →
 *    face (marks drawn on the skin); in front elsewhere → hair_front; behind
 *    the face → body.
 */
export function assignRoles(layers: RawLayerInfo[], roles: ReadonlySet<string>): RoleAssignment[] {
  const out: (RoleAssignment | undefined)[] = layers.map(() => undefined);
  const feature: (string | undefined)[] = [];
  const side: (Side | undefined)[] = [];

  layers.forEach((l, i) => {
    if (!l.bbox) {
      out[i] = { kind: "role", role: null, via: "name" };
      return;
    }
    const inner = [...l.path].reverse();
    for (const name of inner) {
      const r = exactRole(name, roles);
      if (r) {
        out[i] = { kind: "role", role: r, via: "name" };
        return;
      }
    }
    feature[i] = inner.map(featureOf).find(Boolean);
    side[i] = inner.map(sideOf).find(Boolean);
  });

  const isFace = (i: number) => (out[i]?.kind === "role" && (out[i] as { role: string | null }).role === "face") || (!out[i] && feature[i] === "face");
  const faceIdx = layers.map((_, i) => i).filter(isFace);
  const faceBox = union(faceIdx.map((i) => layers[i].bbox!));
  // Pair centre: the face's centre column, or failing a face, that of the paired features.
  const pairIdx = layers.map((_, i) => i).filter((i) => !out[i] && feature[i] === "eye");
  const ref = faceBox ?? union(pairIdx.map((i) => layers[i].bbox!));
  const midX = ref ? ref.x + ref.w / 2 : undefined;
  const faceTop = faceIdx.length ? Math.max(...faceIdx.map((i) => layers[i].order)) : undefined;
  const faceBottom = faceIdx.length ? Math.min(...faceIdx.map((i) => layers[i].order)) : undefined;

  layers.forEach((l, i) => {
    if (out[i]) return;
    const f = feature[i];
    const b = l.bbox!;
    if (f && SIDED.has(f)) {
      const name = (s: Side) => (f === "eye" ? `eye_${s}` : `${f}_${s}`);
      let s = side[i];
      if (!s && midX !== undefined) {
        if (b.x >= midX) s = "L";
        else if (b.x + b.w <= midX) s = "R";
        else {
          out[i] = { kind: "split", L: name("L"), R: name("R"), atX: Math.round(midX), via: "keyword" };
          return;
        }
      }
      out[i] = { kind: "role", role: name(s ?? "L"), via: "keyword" };
      return;
    }
    if (f === "hair") {
      const behind = faceBottom !== undefined && l.order < faceBottom;
      out[i] = { kind: "role", role: behind ? "hair_back" : "hair_front", via: "keyword" };
      return;
    }
    if (f) {
      out[i] = { kind: "role", role: f, via: "keyword" };
      return;
    }
    let role: string;
    if (faceTop === undefined || faceBottom === undefined || !faceBox) role = "body";
    else if (l.order > faceTop) role = inside(b, faceBox) ? "face" : "hair_front";
    else if (l.order < faceBottom) role = "body";
    else role = "face";
    out[i] = { kind: "role", role, via: "position" };
  });
  return out as RoleAssignment[];
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function inside(b: Box, f: Box): boolean {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h && b.w <= f.w && b.h <= f.h;
}

/**
 * PSDTool visibility for one group's children, bottom to top: `!` layers are
 * always shown; among the `*` radio siblings exactly one is shown (the one the
 * file has visible, else the top-most); everything else follows its own flag.
 */
export function visibleChildren<T extends { name?: string; hidden?: boolean }>(children: readonly T[]): T[] {
  const flipped = (c: T) => /:flip[xy]+$/i.test(c.name ?? "");
  const radio = children.filter((c) => (c.name ?? "").startsWith("*") && !flipped(c));
  const chosen = radio.length ? ([...radio].reverse().find((c) => !c.hidden) ?? radio[radio.length - 1]) : undefined;
  return children.filter((c) => {
    const n = c.name ?? "";
    if (flipped(c)) return false;
    if (n.startsWith("!")) return true;
    if (n.startsWith("*")) return c === chosen;
    return !c.hidden;
  });
}
