import type { Env } from "../config/env";
import { liveSessionDeadline } from "./session";

export async function localMailApiProxy(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (env.APP_ENV !== "development" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !env.MAIL_API_BASE_URL) return null;
  if (request.method !== "GET" || !(url.pathname === "/api/console" || url.pathname.startsWith("/api/mail/"))) return null;
  try {
    const base = new URL(env.MAIL_API_BASE_URL);
    if (base.protocol !== "https:" || base.username || base.password || base.origin === url.origin) throw new Error("Invalid upstream");
    const target = new URL(url.pathname + url.search, base.origin);
    const socket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    if (socket && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
      return Response.json({ ok: false, error: "Invalid origin" }, { status: 403 });
    }
    const upstream = await fetch(target, {
      headers: { Authorization: "Bearer " + env.API_AUTH_TOKEN, ...(socket ? { Upgrade: "websocket", "X-Mail-Session-Cap": String(liveSessionDeadline(request)) } : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (socket && upstream.status === 101 && upstream.webSocket) return upstream;
    if (upstream.status >= 300 && upstream.status < 400) throw new Error("Unexpected redirect");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "Mail API connection unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
