// End-to-end check of the Claude Code path: the Agent panel's request is
// handled by the local Claude Code CLI (the signed-in account, no API key),
// which calls this page's tools through the tool hub.
// Run: npm run build && node scripts/agent-e2e.mjs "요청"
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4178;
const OUT = process.env.SMOKE_OUT ?? "smoke-out";
const prompt = process.argv[2] ?? "숨 쉬는 동작을 지금보다 절반 정도로 은은하게 해 줘";
mkdirSync(OUT, { recursive: true });
const env = { ...process.env, NYAL2D_LLM_PROVIDER: "claude-code" };
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "ignore", "inherit"], env });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {}
  if (i > 100) throw new Error("preview server did not start");
  await new Promise((r) => setTimeout(r, 100));
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const log = [];
page.on("console", (m) => log.push(`[${m.type()}] ${m.text()}`));
const results = { prompt };
try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => window.nyal2d.ready);
  await page.click('#panel-switch button[data-view="agent"]');
  await page.waitForSelector(".agent-status.ok", { timeout: 60_000 });
  results.status = await page.locator(".agent-status").textContent();
  await page.waitForFunction(() => window.nyal2d && document.querySelector(".agent-status.ok"));
  await page.fill(".agent-input", prompt);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".thinking") && document.querySelector(".agent-send")?.getAttribute("aria-label") === "보내기" && document.querySelectorAll(".msg.assistant, .msg.error").length > 0, null, { timeout: 300_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/agent-claude-code.png` });
  results.transcript = await page.evaluate(() =>
    [...document.querySelectorAll(".agent-run > *")].map((n) =>
      n.classList.contains("step") ? `STEP ${n.querySelector(".phase")?.textContent} ${n.querySelector(".step-title")?.lastChild?.textContent} [${n.className}] ${n.querySelector(".step-detail")?.textContent}` : `${n.className}: ${n.textContent}`,
    ),
  );
  results.changes = await page.evaluate(() => window.nyal2d.session().changes.map((c) => `${c.label}·${c.source}`));
} catch (err) {
  results.error = String(err);
  await page.screenshot({ path: `${OUT}/agent-claude-code-error.png` });
} finally {
  results.console = log.filter((l) => !l.includes("[debug]"));
  writeFileSync(`${OUT}/agent-e2e.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  server.kill();
}
