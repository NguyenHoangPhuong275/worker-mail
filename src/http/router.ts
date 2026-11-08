import type { Env } from "../config/env";
import { consoleResponse } from "./console";
import { hasAccess, sessionResponse } from "./session";
import { localMailApiProxy } from "./mail-api-proxy";
import { mailApiResponse } from "./mail-api";

export async function handleHttpRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // 1. CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // Health check
  if (url.pathname === "/health") {
    return Response.json({
      ok: true,
      service: "worker-mail",
      environment: env.APP_ENV ?? "production",
      timestamp: Date.now(),
    });
  }

  if (url.pathname === "/api/session") return sessionResponse(request, env);

  if (!(await hasAccess(request, env))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const proxied = await localMailApiProxy(request, env);
  if (proxied) return proxied;

  if (url.pathname === "/api/console" && request.method === "GET") {
    return consoleResponse(env);
  }

  if (url.pathname.startsWith("/api/mail/")) return mailApiResponse(request, env);

  return new Response("Not Found", { status: 404 });
}
