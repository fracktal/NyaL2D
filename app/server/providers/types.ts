import type { ProxyHealth, TurnRequest, TurnResponse } from "../../src/agent/protocol.ts";

/** One LLM backend behind the proxy. Add a provider by implementing this. */
export interface Provider {
  health(): Promise<ProxyHealth>;
  turn(req: TurnRequest, signal: AbortSignal): Promise<TurnResponse>;
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
