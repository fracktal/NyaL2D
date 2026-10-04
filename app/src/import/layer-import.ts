/**
 * Layered art → rigged `.iki`, in the browser.
 *
 * Takes a PSD, or a set of same-sized transparent PNG/WebP layers, maps every
 * layer onto an auto-rig role by its name (`./roles.ts`), composites the
 * layers of each role into one, and hands the result to `@ikijs/editor`'s
 * auto-rig (`createLayerSetMeasurer` → `generateIkiFromLayerSet`), then packs
 * the parts into one atlas texture.
 *
 * The measure/crop/pack/atlas steps follow the Iki editor app's own auto-rig
 * import (zeikar/iki examples/editor, MIT). What this adds is accepting art
 * that was not drawn for Iki: nested groups, hidden and PSDTool variant
 * layers, opacity, clipping, masks, arbitrary layer names, both eyes in one
 * layer, and documents larger than the rig needs.
 */

import {
  createLayerSetMeasurer,
  EditorDocument,
  generateIkiFromLayerSet,
  packAtlas,
  parseLayerRoles,
  uvRectFor,
  type AtlasAssignment,
  type AtlasLayout,
} from "@ikijs/editor";
import { readPsd, type Layer as PsdLayer } from "ag-psd";
import { assignRoles, cleanName, visibleChildren, type Box, type RawLayerInfo, type RoleAssignment } from "./roles";

/** Every role the auto-rig knows, bottom to top (`@ikijs/editor` ROLE_TABLE). */
export const RIG_ROLES = [
  "hair_back", "body", "face", "blush_L", "blush_R", "nose", "mouth", "mouth_open",
  "eye_L", "eye_R", "iris_L", "iris_R", "pupil_L", "pupil_R", "highlight_L", "highlight_R",
  "lash_L", "lash_R", "brow_L", "brow_R", "hair_front",
] as const;
const ROLE_SET: ReadonlySet<string> = new Set(RIG_ROLES);
const REQUIRED = ["face", "eye_L", "eye_R", "mouth"];

/** Longest canvas side the rig is built at; larger art is scaled down. */
const MAX_SIDE = 2048;
/** Largest atlas page; a bigger pack is retried at a smaller scale. */
const MAX_ATLAS = 4096;
/** Decode budget for the source document. */
const MAX_SOURCE_MEGAPIXELS = 256;
const ALPHA_MIN = 8;

export interface ImportReport {
  source: { width: number; height: number; layers: number };
  canvas: { width: number; height: number };
  /** Each role in the model and the source layers composited into it. */
  roles: { role: string; from: string[] }[];
  /** Source layers left out, with why. */
  dropped: { layer: string; reason: string }[];
}

export interface ImportResult {
  name: string;
  /** Validated `.iki` JSON. */
  text: string;
  report: ImportReport;
}

/** Whether a file selection is layered art for this importer rather than a model file. */
export function isLayeredArt(files: readonly File[]): boolean {
  return files.some((f) => /\.(psd|png|webp)$/i.test(f.name) || f.type === "image/png" || f.type === "image/webp" || f.type === "image/vnd.adobe.photoshop");
}

interface RawLayer extends RawLayerInfo {
  label: string;
  /** Pixels at the layer's own bounds, straight alpha, opacity and mask applied. */
  image: ImageData;
  left: number;
  top: number;
  /** Index of the layer this one is clipped to, if any. */
  clipTo?: number;
}

interface SourceDoc {
  width: number;
  height: number;
  layers: RawLayer[];
  dropped: { layer: string; reason: string }[];
}

export async function importLayeredArt(files: File[]): Promise<ImportResult> {
  const psd = files.find((f) => /\.psd$/i.test(f.name));
  const src = psd ? await readPsdLayers(psd) : await readImageLayers(files);
  const name = (psd ? cleanName(psd.name) : "layers") || "imported";

  const assignment = assignRoles(src.layers, ROLE_SET);
  // A clipped layer belongs wherever its base went.
  src.layers.forEach((l, i) => {
    if (l.clipTo !== undefined) assignment[i] = assignment[l.clipTo];
  });

  const from = new Map<string, string[]>();
  const dropped = [...src.dropped];
  src.layers.forEach((l, i) => {
    const a = assignment[i];
    const roles = a.kind === "split" ? [a.L, a.R] : a.role ? [a.role] : [];
    if (!roles.length) dropped.push({ layer: l.label, reason: l.bbox ? "역할 없음" : "빈 레이어" });
    for (const r of roles) from.set(r, [...(from.get(r) ?? []), l.label + (a.kind === "split" ? " (좌우 분할)" : "")]);
  });
  const missing = REQUIRED.filter((r) => !from.has(r));
  if (missing.length) {
    const found = [...from.keys()].join(", ") || "없음";
    throw new Error(
      `자동 리깅에 필요한 부위를 찾지 못했습니다: ${missing.join(", ")}. 찾은 부위: ${found}. ` +
        `레이어(또는 그룹) 이름에 얼굴/눈/입 등이 드러나야 합니다 (예: 顔, 目, 口 / 얼굴, 눈, 입 / face, eye_L, mouth). ` +
        `레이어가 없는 한 장짜리 그림은 먼저 See-Through 같은 도구로 레이어를 나눠야 합니다.`,
    );
  }

  let scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  for (;;) {
    const result = await rig(src, assignment, scale);
    if (result) {
      const model = result.toIkiModel();
      model.name = name;
      return {
        name,
        text: JSON.stringify(model),
        report: {
          source: { width: src.width, height: src.height, layers: src.layers.length },
          canvas: model.canvas,
          roles: RIG_ROLES.filter((r) => from.has(r) && model.parts.some((p) => p.id === r)).map((r) => ({ role: r, from: from.get(r)! })),
          dropped,
        },
      };
    }
    scale *= 0.75;
    if (scale * Math.max(src.width, src.height) < 256) throw new Error("아틀라스가 너무 커서 모델을 만들 수 없습니다");
  }
}

/** Composite, measure, rig and texture at one scale; undefined when the atlas would be too large. */
async function rig(src: SourceDoc, assignment: RoleAssignment[], scale: number): Promise<EditorDocument | undefined> {
  const W = Math.max(1, Math.round(src.width * scale));
  const H = Math.max(1, Math.round(src.height * scale));

  // One canvas per role, layers drawn bottom to top.
  const canvases = new Map<string, HTMLCanvasElement>();
  const target = (role: string) => {
    let c = canvases.get(role);
    if (!c) {
      c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      canvases.set(role, c);
    }
    return c.getContext("2d")!;
  };
  const bitmaps = new Map<number, ImageBitmap>();
  const bitmapOf = async (i: number) => {
    let b = bitmaps.get(i);
    if (!b) bitmaps.set(i, (b = await createImageBitmap(src.layers[i].image, { premultiplyAlpha: "none" })));
    return b;
  };
  try {
    for (let i = 0; i < src.layers.length; i++) {
      const l = src.layers[i];
      const a = assignment[i];
      if (!l.bbox || (a.kind === "role" && !a.role)) continue;
      const drawn = await layerOnCanvas(l, await bitmapOf(i), l.clipTo !== undefined ? src.layers[l.clipTo] : undefined, l.clipTo !== undefined ? await bitmapOf(l.clipTo) : undefined, W, H, scale);
      if (a.kind === "split") {
        const at = Math.round(a.atX * scale);
        target(a.L).drawImage(drawn, at, 0, W - at, H, at, 0, W - at, H);
        if (at > 0) target(a.R).drawImage(drawn, 0, 0, at, H, 0, 0, at, H);
      } else {
        target(a.role!).drawImage(drawn, 0, 0);
      }
    }
  } finally {
    for (const b of bitmaps.values()) b.close();
  }

  // Measure each role once, in role order, then crop it.
  const roles = RIG_ROLES.filter((r) => canvases.has(r));
  parseLayerRoles(roles);
  const measurer = createLayerSetMeasurer({ width: W, height: H });
  const crops: { id: string; bitmap: ImageBitmap; width: number; height: number }[] = [];
  try {
    const layers = [];
    for (const role of roles) {
      const c = canvases.get(role)!;
      const input = measurer.add({ role, fileName: role, rgba: c.getContext("2d")!.getImageData(0, 0, W, H).data });
      if (!input) {
        if (REQUIRED.includes(role)) throw new Error(`${role} 레이어가 비어 있습니다`);
        continue;
      }
      layers.push(input);
      crops.push({ id: role, width: input.cropW, height: input.cropH, bitmap: await createImageBitmap(c, input.bbox.x, input.bbox.y, input.bbox.w, input.bbox.h, { premultiplyAlpha: "none" }) });
      c.width = c.height = 0;
    }
    const { turnOptions } = measurer.finish();
    const layout = packAtlas(crops.map(({ id, width, height }) => ({ id, width, height })));
    if (layout.pageWidth > MAX_ATLAS || layout.pageHeight > MAX_ATLAS) return undefined;

    const doc = new EditorDocument(generateIkiFromLayerSet(layers, { width: W, height: H }, turnOptions));
    const page = { width: layout.pageWidth, height: layout.pageHeight };
    const partTextureAssignments: AtlasAssignment[] = layout.placements.map((p) => ({ partId: p.id, uv: uvRectFor(p, page) }));
    doc.applyAtlas({ textures: [{ source: renderAtlas(crops, layout) }], partTextureAssignments });
    return doc;
  } finally {
    for (const c of crops) c.bitmap.close();
  }
}

/** A layer placed on a full canvas at `scale`, clipped to its base if it has one. */
async function layerOnCanvas(l: RawLayer, bmp: ImageBitmap, base: RawLayer | undefined, baseBmp: ImageBitmap | undefined, W: number, H: number, scale: number): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, l.left * scale, l.top * scale, l.image.width * scale, l.image.height * scale);
  if (base && baseBmp) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(baseBmp, base.left * scale, base.top * scale, base.image.width * scale, base.image.height * scale);
  }
  return c;
}

/**
 * Draw the packed crops into one PNG page, extruding each crop's right and
 * bottom edge across the gutter so linear sampling at the inset UV never
 * reads a transparent neighbour (as the Iki editor's renderAtlas does).
 */
function renderAtlas(crops: { id: string; bitmap: ImageBitmap }[], layout: AtlasLayout): string {
  const canvas = document.createElement("canvas");
  canvas.width = layout.pageWidth;
  canvas.height = layout.pageHeight;
  const ctx = canvas.getContext("2d")!;
  const byId = new Map(crops.map((c) => [c.id, c.bitmap]));
  const pad = layout.padding;
  for (const p of layout.placements) {
    const bmp = byId.get(p.id)!;
    const { x, y, width: w, height: h } = p;
    ctx.drawImage(bmp, x, y, w, h);
    if (pad > 0) {
      ctx.drawImage(bmp, w - 1, 0, 1, h, x + w, y, pad, h);
      ctx.drawImage(bmp, 0, h - 1, w, 1, x, y + h, w, pad);
      ctx.drawImage(bmp, w - 1, h - 1, 1, 1, x + w, y + h, pad, pad);
    }
  }
  const uri = canvas.toDataURL("image/png");
  if (!uri.startsWith("data:image/png")) throw new Error("아틀라스 이미지를 만들지 못했습니다 (캔버스가 너무 큽니다)");
  return uri;
}

// --- Sources --------------------------------------------------------------------

async function readPsdLayers(file: File): Promise<SourceDoc> {
  const buffer = await file.arrayBuffer();
  let psd;
  try {
    psd = readPsd(buffer, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  } catch (err) {
    throw new Error(`PSD를 읽지 못했습니다: ${(err as Error).message}`);
  }
  if (psd.width * psd.height > MAX_SOURCE_MEGAPIXELS * 1e6) throw new Error(`PSD가 너무 큽니다 (${psd.width}×${psd.height})`);

  const layers: RawLayer[] = [];
  const dropped: SourceDoc["dropped"] = [];
  const walk = (children: PsdLayer[], path: string[], opacity: number) => {
    const shown = new Set(visibleChildren(children));
    let base: number | undefined;
    for (const c of children) {
      const name = c.name ?? "(이름 없음)";
      const label = [...path, name].map(cleanName).join("/");
      if (!shown.has(c)) {
        if (!c.clipping) base = undefined;
        continue;
      }
      if (c.children) {
        walk(c.children, [...path, name], opacity * (c.opacity ?? 1));
        base = undefined;
        continue;
      }
      if (c.text || c.adjustment || !c.imageData || !c.imageData.width || !c.imageData.height) {
        if (c.text) dropped.push({ layer: label, reason: "텍스트 레이어" });
        if (!c.clipping) base = undefined;
        continue;
      }
      const image = toImageData(c, opacity * (c.opacity ?? 1));
      const layer: RawLayer = {
        path: [...path, name],
        label,
        order: layers.length,
        image,
        left: c.left ?? 0,
        top: c.top ?? 0,
        bbox: alphaBox(image, c.left ?? 0, c.top ?? 0),
      };
      if (c.clipping && base !== undefined) layer.clipTo = base;
      else base = layers.length;
      layers.push(layer);
    }
  };
  walk(psd.children ?? [], [], 1);
  if (!layers.length) throw new Error("PSD에 가져올 수 있는 래스터 레이어가 없습니다");
  return { width: psd.width, height: psd.height, layers, dropped };
}

/** A PSD layer's pixels as straight-alpha 8-bit RGBA, with opacity and mask folded into alpha. */
function toImageData(layer: PsdLayer, opacity: number): ImageData {
  const { data, width, height } = layer.imageData!;
  const out = new Uint8ClampedArray(width * height * 4);
  if (data instanceof Uint8ClampedArray || data instanceof Uint8Array) out.set(data);
  else if (data instanceof Uint16Array) for (let i = 0; i < out.length; i++) out[i] = data[i] / 257;
  else for (let i = 0; i < out.length; i++) out[i] = data[i] * 255;

  const mask = layer.mask;
  const m = mask && !mask.disabled && mask.imageData ? mask.imageData : undefined;
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 + 3;
      let a = out[i] * opacity;
      if (m) {
        const mx = left + x - (mask!.left ?? 0);
        const my = top + y - (mask!.top ?? 0);
        const v = mx >= 0 && my >= 0 && mx < m.width && my < m.height ? Number(m.data[(my * m.width + mx) * 4]) : (mask!.defaultColor ?? 255);
        a = (a * v) / 255;
      }
      out[i] = a;
    }
  }
  return new ImageData(out, width, height);
}

async function readImageLayers(files: File[]): Promise<SourceDoc> {
  const images = files.filter((f) => /\.(png|webp)$/i.test(f.name) || f.type === "image/png" || f.type === "image/webp");
  if (images.length < 2) {
    throw new Error(
      "레이어가 하나뿐인 그림은 자동 리깅할 수 없습니다. PSD 파일이나, 부위별로 나뉜 같은 크기의 투명 PNG 여러 장(face, eye_L, eye_R, mouth …)을 함께 넣어 주세요.",
    );
  }
  const layers: RawLayer[] = [];
  let W = 0;
  let H = 0;
  for (const f of images) {
    const bmp = await createImageBitmap(f, { premultiplyAlpha: "none", imageOrientation: "none" });
    if (!W) [W, H] = [bmp.width, bmp.height];
    if (bmp.width !== W || bmp.height !== H) {
      bmp.close();
      throw new Error(`"${f.name}" 크기(${bmp.width}×${bmp.height})가 첫 레이어(${W}×${H})와 다릅니다. 모든 레이어는 같은 캔버스 크기여야 합니다.`);
    }
    if (W * H * images.length > MAX_SOURCE_MEGAPIXELS * 1e6) throw new Error("레이어 이미지가 너무 크거나 많습니다");
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const image = ctx.getImageData(0, 0, W, H);
    layers.push({ path: [f.name], label: f.name, order: layers.length, image, left: 0, top: 0, bbox: alphaBox(image, 0, 0) });
  }
  return { width: W, height: H, layers, dropped: [] };
}

function alphaBox(img: ImageData, left: number, top: number): Box | null {
  const { data, width, height } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= ALPHA_MIN) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: left + x0, y: top + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
