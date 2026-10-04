import type { ProxyHealth, RunEvent, RunRequest, TurnRequest, TurnResponse } from "../../src/agent/protocol.ts";

/**
 * One LLM backend behind the proxy. Add a provider by implementing this.
 * A provider either answers single turns (the browser runs the loop) or runs
 * whole requests itself, calling the page's tools through the tool hub.
 */
export interface Provider {
  health(): Promise<ProxyHealth>;
  turn?(req: TurnRequest, signal: AbortSignal): Promise<TurnResponse>;
  run?(req: RunRequest, signal: AbortSignal, emit: (e: RunEvent) => void): Promise<void>;
  /** Extra HTTP routes the provider serves (e.g. the MCP endpoint). Return true if handled. */
  handle?(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL): Promise<boolean>;
  close?(): Promise<void>;
}

/** A failure the proxy reports to the browser as `{ error, retryable }`. */
export class ProviderError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 502, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}
