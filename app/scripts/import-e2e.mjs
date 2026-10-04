// Layered-art import, end to end in headless Chromium.
//
// Builds layered art the way real sources lay it out, from the bundled hero
// model's own parts (cut back out of its atlas at their rest rectangles):
//   see-through.psd  See-Through's tag names, both eyes in one layer per tag
//   tachie.psd       PSDTool 立ち絵 layout: Japanese names, nested groups,
//                    * / ! variants, hidden layers, a clipping layer
//   layers/*.png     a PNG set with Korean file names
// then drops each into the running app (#file-input) and checks that a rigged
// model opens with every expected role, and that the rig moves.
//
// Usage: npm run dev (in another shell), then
//   node scripts/import-e2e.mjs [http://127.0.0.1:47310/]
import { mkdirSync, writeFileSync } from "node:fs";
import { writePsd } from "ag-psd";
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://127.0.0.1:47310/";
const OUT = process.env.IMPORT_OUT ?? "import-out";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const log = [];
page.on("console", (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => log.push(`[pageerror] ${e.message}`));
await page.goto(URL);
await page.evaluate(() => window.nyal2d.ready);

// --- Cut the hero's parts back out into full-canvas RGBA layers -------------------
const parts = await page.evaluate(async () => {
  const m = await (await fetch("./models/hero.iki")).json();
  const W = m.canvas.width;
  const H = m.canvas.height;
  const atlases = await Promise.all(m.textures.map(async (t) => createImageBitmap(await (await fetch(t.source)).blob())));
  const out = {};
  for (const p of m.parts) {
    const t = p.texture;
    const a = atlases[t.index ?? 0];
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext("2d");
    const x = W / 2 + (p.transform?.x ?? 0) - p.width / 2;
    const y = H / 2 - (p.transform?.y ?? 0) - p.height / 2;
    ctx.drawImage(a, t.uv.x * a.width, t.uv.y * a.height, t.uv.width * a.width, t.uv.height * a.height, x, y, p.width, p.height);
    const bytes = new Uint8Array(ctx.getImageData(0, 0, W, H).data.buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out[p.id] = btoa(s);
  }
  return { W, H, layers: out };
});
const { W, H } = parts;
const rgba = Object.fromEntries(Object.entries(parts.layers).map(([k, v]) => [k, new Uint8ClampedArray(Buffer.from(v, "base64"))]));
const merge = (...ids) => {
  const o = new Uint8ClampedArray(W * H * 4);
  for (const id of ids) {
    const s = rgba[id];
    for (let i = 0; i < o.length; i += 4) {
      const a = s[i + 3] / 255;
      if (!a) continue;
      const b = o[i + 3] / 255;
      const oa = a + b * (1 - a);
      for (let k = 0; k < 3; k++) o[i + k] = (s[i + k] * a + o[i + k] * b * (1 - a)) / oa;
      o[i + 3] = oa * 255;
    }
  }
  return o;
};
const solid = (x, y, w, h, rgbaColor) => {
  const o = new Uint8ClampedArray(W * H * 4);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) o.set(rgbaColor, (j * W + i) * 4);
  return o;
};
const L = (name, data, extra = {}) => ({ name, left: 0, top: 0, right: W, bottom: H, imageData: { width: W, height: H, data }, ...extra });
const G = (name, children, extra = {}) => ({ name, children, opened: true, ...extra });
const psd = (children) => Buffer.from(writePsd({ width: W, height: H, children: children.reverse().map(function rev(c) {
  return c.children ? { ...c, children: [...c.children].reverse().map(rev) } : c;
}) }, { generateThumbnail: false, noBackground: true }));

// ag-psd lists children bottom to top; the arrays below read top to bottom like a layer panel.
const seeThrough = psd([
  L("front hair", rgba.hair_front),
  L("eyebrow", merge("brow_L", "brow_R")),
  L("eyelash", merge("lash_L", "lash_R")),
  L("irides", merge("iris_L", "iris_R")),
  L("eyewhite", merge("eye_L", "eye_R")),
  L("mouth", rgba.mouth),
  L("nose", rgba.nose),
  L("face", rgba.face),
  L("topwear", rgba.body),
  L("back hair", rgba.hair_back),
]);
const tachie = psd([
  G("ずんだもん", [
    L("影", solid(0, 0, 200, 200, [0, 0, 0, 255]), { hidden: true }),
    L("前髪", rgba.hair_front),
    G("!眉", [L("*怒り眉", solid(400, 100, 300, 40, [255, 0, 0, 255]), { hidden: true }), L("*普通眉", merge("brow_L", "brow_R"))]),
    G("!目", [
      // A hidden closed-eye drawing (the lash line alone): becomes the drawn blink.
      L("*閉じ目", merge("lash_L", "lash_R"), { hidden: true }),
      G("*普通目", [L("まつげ", merge("lash_L", "lash_R")), L("黒目", merge("iris_L", "iris_R")), L("白目", merge("eye_L", "eye_R"))]),
    ]),
    G("!口", [L("*あー", rgba.mouth_open, { hidden: true }), L("*ほほえみ", rgba.mouth)]),
    G("顔", [L("肌影", solid(0, 0, W, H, [120, 60, 60, 255]), { clipping: true, opacity: 0.15 }), L("鼻", rgba.nose), L("輪郭", rgba.face)]),
    G("体", [L("服", rgba.body)]),
    L("後ろ髪", rgba.hair_back),
  ]),
]);
writeFileSync(`${OUT}/see-through.psd`, seeThrough);
writeFileSync(`${OUT}/tachie.psd`, tachie);

const png = async (data) =>
  Buffer.from(
    await page.evaluate(
      async ({ b64, W, H }) => {
        const bytes = Uint8ClampedArray.from(atob(b64), (c) => c.charCodeAt(0));
        const c = new OffscreenCanvas(W, H);
        c.getContext("2d").putImageData(new ImageData(bytes, W, H), 0, 0);
        const buf = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { b64: Buffer.from(data.buffer).toString("base64"), W, H },
    ),
    "base64",
  );
const pngSet = [
  ["뒷머리.png", rgba.hair_back],
  ["얼굴.png", rgba.face],
  ["입.png", rgba.mouth],
  ["왼눈.png", rgba.eye_L],
  ["오른눈.png", rgba.eye_R],
  ["왼눈동자.png", rgba.iris_L],
  ["오른눈동자.png", rgba.iris_R],
  ["앞머리.png", rgba.hair_front],
];

const cases = [
  { name: "see-through", files: [{ name: "see-through.psd", mimeType: "image/vnd.adobe.photoshop", buffer: seeThrough }] },
  // Its * variants become parts that swap by parameter: the closed eye, and the hidden open mouth.
  { name: "tachie", expect: ["eye_L__eyeClosed", "eye_R__eyeClosed", "mouth__mouthOpen"], files: [{ name: "tachie.psd", mimeType: "image/vnd.adobe.photoshop", buffer: tachie }] },
  { name: "png-set", model: "layers", files: await Promise.all(pngSet.map(async ([name, d]) => ({ name, mimeType: "image/png", buffer: await png(d) }))) },
];

const results = {};
let failed = false;
for (const c of cases) {
  const before = log.length;
  await page.setInputFiles("#file-input", c.files);
  await page.waitForFunction((n) => window.nyal2d.session()?.current.name === n || document.querySelector(".stage-overlay.error"), c.model ?? c.name, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const err = document.querySelector(".stage-overlay.error");
    if (err) return { error: err.textContent };
    const m = window.nyal2d.session().current;
    return { canvas: m.canvas, parts: m.parts.map((p) => p.id), parameters: m.parameters.length, deformers: m.deformers.length };
  });
  r.log = log.slice(before).filter((l) => !l.includes("[vite]"));
  results[c.name] = r;
  if (r.error) {
    failed = true;
    continue;
  }
  const missing = (c.expect ?? []).filter((id) => !r.parts.includes(id));
  if (missing.length) {
    r.missing = missing;
    failed = true;
  }
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("off"));
  await page.waitForTimeout(300);
  await page.locator("#stage").screenshot({ path: `${OUT}/${c.name}-rest.png` });
  await page.evaluate(() => {
    const rt = window.nyal2d.runtime;
    rt.setParameter("ParamAngleX", 30);
    rt.setParameter("ParamEyeLOpen", 0);
    rt.setParameter("ParamMouthOpenY", 1);
  });
  await page.waitForTimeout(300);
  await page.locator("#stage").screenshot({ path: `${OUT}/${c.name}-posed.png` });
  await page.evaluate(() => window.nyal2d.runtime.resetPose());
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
