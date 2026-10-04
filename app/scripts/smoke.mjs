// Browser smoke test / experiment harness.
// Run via `npm run smoke` (builds first). Serves dist/ with
// `vite preview`, opens it in headless Chromium, and records observations
// that docs/iki/*.md cite as "Observed".
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4179;
const OUT = process.env.SMOKE_OUT ?? "smoke-out";
mkdirSync(OUT, { recursive: true });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "ignore", "inherit"],
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {}
  if (i > 100) throw new Error("preview server did not start");
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));

const results = {};
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => window.nyal2d.ready);
  await page.waitForTimeout(500);

  // Capture through the app's own path and count non-transparent pixels.
  const frameStats = () =>
    page.evaluate(async () => {
      const blob = await window.nyal2d.runtime.captureFrame();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let opaque = 0;
      let hash = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) opaque++;
        hash = (hash * 31 + data[i - 3] + data[i - 2] * 7 + data[i]) >>> 0;
      }
      return { width: bmp.width, height: bmp.height, opaque, hash, bytes: blob.size };
    });

  results.webgl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  results.snapshot = await page.evaluate(() => {
    const s = window.nyal2d.inspect();
    return { name: s.name, parameters: s.parameters.length, parts: s.parts.length, deformers: s.deformers.length, physics: s.physics.length };
  });
  results.drivenParameterIds = await page.evaluate(() => [...window.nyal2d.runtime.drivenParameterIds]);
  results.firstFrame = await frameStats();
  // Control: read the canvas from a timer instead of a rAF callback.
  results.captureOutsideRaf = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 50));
    const url = document.getElementById("canvas").toDataURL("image/png");
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return { opaque };
  });
  await page.screenshot({ path: `${OUT}/01-loaded.png` });

  // Freeze motion so parameter experiments are deterministic.
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("off"));
  await page.waitForTimeout(100);
  results.restFrame = await frameStats();
  await page.evaluate(() => window.nyal2d.runtime.setParameter("ParamAngleX", 30));
  await page.waitForTimeout(100);
  results.angleX30Frame = await frameStats();
  await page.screenshot({ path: `${OUT}/02-angleX30.png` });
  await page.evaluate(() => window.nyal2d.runtime.setParameter("ParamAngleX", 0));

  // Idle motion: frames should differ over time.
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("idle"));
  const hashes = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(400);
    hashes.push((await frameStats()).hash);
  }
  results.idleFrameHashesDistinct = new Set(hashes).size;

  // Physics trajectory: step AngleX and sample the physics output over time.
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("off"));
  // In "physics" mode nothing else writes ParamAngleX, so the input is a clean step.
  const trajectory = async () =>
    page.evaluate(async () => {
      const rt = window.nyal2d.runtime;
      rt.setMotionMode("off");
      rt.setParameter("ParamAngleX", 0);
      rt.setParameter("ParamHairSwayX", 0);
      rt.setMotionMode("physics");
      await new Promise((r) => setTimeout(r, 300));
      rt.setParameter("ParamAngleX", 30);
      const samples = [];
      const t0 = performance.now();
      await new Promise((resolve) => {
        const step = () => {
          const t = performance.now() - t0;
          samples.push([Math.round(t), +rt.getParameter("ParamHairSwayX").toFixed(3)]);
          if (t < 2000) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      rt.setMotionMode("off");
      return samples.filter((_, i) => i % 6 === 0);
    });
  results.hairSwayStepResponse = await trajectory();

  // Reversible change through the UI: edit hairSway stiffness in the inspector.
  const stiffness = page.locator("#inspector details:has(> summary:text-is('hairSway')) dd input").nth(3);
  await stiffness.fill("120");
  await stiffness.press("Tab");
  await page.waitForTimeout(300);
  results.afterEdit = await page.evaluate(() => {
    const s = window.nyal2d.session();
    return {
      changes: s.changes,
      currentStiffness: s.current.physics.find((r) => r.id === "hairSway").stiffness,
      originalStiffness: s.original.physics.find((r) => r.id === "hairSway").stiffness,
      runtimeStiffness: window.nyal2d.runtime.loadedModel.physics.find((r) => r.id === "hairSway").stiffness,
    };
  });
  results.hairSwayStepResponseStiff = await trajectory();
  await page.screenshot({ path: `${OUT}/03-after-edit.png` });
  await page.click("#undo");
  await page.waitForTimeout(300);
  results.afterUndo = await page.evaluate(() => ({
    changes: window.nyal2d.session().changes.length,
    runtimeStiffness: window.nyal2d.runtime.loadedModel.physics.find((r) => r.id === "hairSway").stiffness,
  }));

  results.console = consoleLines;
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  server.kill();
}
