import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { MCP_INSTRUCTIONS } from "../../src/agent/prompt.ts";
import type { RunEvent } from "../../src/agent/protocol.ts";
import type { ToolHub } from "../tool-hub.ts";
import type { Provider } from "./types.ts";

/**
 * Runs each Agent-panel request through the Claude Code CLI on this machine,
 * signed in with the person's own Claude account, so no API key is needed.
 *
 * Claude Code gets exactly one MCP server, the app server's /llm/mcp,
 * whose tools are the open NyaL2D page's tools (through the tool hub); its
 * built-in tools (files, shell, web) are disabled. Conversations continue
 * across requests with --resume.
 *
 * Meant for trying the agent locally. Claude Code's own terms apply: a
 * product shipped to other people should use an API key provider instead.
 */
export function createClaudeCodeProvider(opts: { hub: ToolHub; mcpUrl: () => string; command?: string; model?: string }): Provider {
  const command = opts.command ?? findClaude() ?? "claude";
  const hub = opts.hub;
  const workdir = join(tmpdir(), "nyal2d-agent");
  mkdirSync(workdir, { recursive: true });
  let healthCache: { at: number; ready: boolean; detail?: string } | undefined;

  return {
    async health() {
      if (!healthCache || Date.now() - healthCache.at > 60_000) healthCache = { at: Date.now(), ...(await authStatus(command)) };
      return { provider: "claude-code", model: opts.model ?? "Claude Code", mode: "run", ready: healthCache.ready, detail: healthCache.detail };
    },

    async run(req, signal, emit) {
      if (!(await hub.waitForPage(8_000))) {
        emit({ type: "error", error: "NyaL2D 페이지가 서버에 연결되지 않았습니다. 페이지를 새로고침해 보세요." });
        return;
      }
      hub.announce({ name: "Claude Code", version: "app" });
      const sessionId = req.sessionId ?? randomUUID();
      const args = [
        "-p",
        req.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        ...(req.sessionId ? ["--resume", sessionId] : ["--session-id", sessionId]),
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        JSON.stringify({ mcpServers: { nyal2d: { type: "http", url: opts.mcpUrl() } } }),
        "--allowedTools",
        "mcp__nyal2d",
        "--append-system-prompt",
        `${MCP_INSTRUCTIONS}\n\nThe person is typing in the NyaL2D Agent panel and sees each tool step there. Reply in their language, briefly: what you changed, what you measured, and what they might try next.`,
        ...(opts.model ? ["--model", opts.model] : []),
      ];
      await runClaude(command, args, workdir, signal, emit, sessionId);
    },
  };
}

/**
 * Where the Claude Code CLI is, when it is not simply on PATH: the native
 * installer puts it in ~/.local/bin, which shells started without a login
 * profile (an editor, a service, `wsl -e`) often do not have on PATH; npm
 * under nvm puts it in a per-version bin folder. Windows folders that WSL
 * appends to PATH (/mnt/...) are skipped: a Windows install cannot run here.
 */
export function findClaude(env: NodeJS.ProcessEnv = process.env, home = homedir()): string | undefined {
  const dirs = (env.PATH ?? "").split(delimiter).filter((d) => d && !d.startsWith("/mnt/"));
  dirs.push(join(home, ".local", "bin"), join(home, ".claude", "local"), join(home, ".npm-global", "bin"), "/usr/local/bin");
  try {
    const nvm = join(env.NVM_DIR ?? join(home, ".nvm"), "versions", "node");
    for (const v of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, v, "bin"));
  } catch {
    // No nvm.
  }
  for (const dir of dirs) {
    const file = join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

/** Environment for a standalone Claude Code run, even when the proxy itself was started from inside Claude Code. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || /^CLAUDE_CODE_(SESSION|CHILD_SESSION|REMOTE_SESSION)/.test(k)) delete env[k];
  return env;
}

function authStatus(command: string): Promise<{ ready: boolean; detail?: string }> {
  return new Promise((resolve) => {
    execFile(command, ["auth", "status", "--json"], { timeout: 20_000, env: childEnv() }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return resolve({ ready: false, detail: "Claude Code CLI(claude)를 찾을 수 없습니다. 설치했다면 `which claude`로 나온 경로를 NYAL2D_CLAUDE_BIN에 지정해 앱을 다시 시작하세요. 없다면 설치 후 `claude auth login`." });
      }
      try {
        const s = JSON.parse(stdout) as { loggedIn?: boolean };
        resolve(s.loggedIn ? { ready: true } : { ready: false, detail: "Claude Code에 로그인되어 있지 않습니다. `claude auth login`을 실행하세요." });
      } catch {
        resolve({ ready: false, detail: `claude auth status를 읽지 못했습니다${err ? `: ${err.message}` : ""}` });
      }
    });
  });
}

/** Run the CLI and translate its stream-json output into run events. */
export function runClaude(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  emit: (e: RunEvent) => void,
  sessionId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let finished = false;
    let stderr = "";
    let buf = "";
    const finish = (e: RunEvent) => {
      if (finished) return;
      finished = true;
      emit(e);
    };
    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (d) => (stderr = (stderr + String(d)).slice(-4000)));
    child.stdout.on("data", (d) => {
      buf += String(d);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handle(line);
      }
    });

    const handle = (line: string) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === "system" && msg.subtype === "init") {
        const s = (msg.mcp_servers ?? []).find((x: { name: string }) => x.name === "nyal2d");
        if (s && s.status !== "connected") emit({ type: "text", text: `(NyaL2D 도구 서버 상태: ${s.status})` });
      } else if (msg.type === "assistant") {
        for (const b of msg.message?.content ?? []) if (b.type === "text" && b.text?.trim()) emit({ type: "text", text: b.text });
      } else if (msg.type === "result") {
        if (msg.is_error || msg.subtype !== "success") {
          finish({ type: "error", error: typeof msg.result === "string" && msg.result ? msg.result : `Claude Code가 작업을 끝내지 못했습니다 (${msg.subtype})` });
        } else {
          finish({ type: "done", sessionId: msg.session_id ?? sessionId });
        }
      }
    };

    child.on("error", (err) => {
      finish({ type: "error", error: (err as NodeJS.ErrnoException).code === "ENOENT" ? "Claude Code CLI(claude)를 찾을 수 없습니다" : err.message });
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) finish({ type: "done", sessionId, note: "중단했습니다." });
      else if (code !== 0) finish({ type: "error", error: `Claude Code가 오류로 끝났습니다 (코드 ${code})${stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}` });
      else finish({ type: "done", sessionId });
      resolve();
    });
  });
}
