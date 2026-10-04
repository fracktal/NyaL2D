/**
 * Only pages served from this machine may use the app server: it spends the
 * user's API credit, so an arbitrary website must not be able to call it.
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin requests through the Vite proxy, curl
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}
