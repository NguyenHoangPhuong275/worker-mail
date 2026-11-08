import type { Env } from "../config/env";

const COOKIE = "worker_mail_session";
const LIFETIME_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

/** Called only after hasAccess; sockets renew at least every 15 minutes. */
export function liveSessionDeadline(request: Request): number {
  const cap = Date.now() + 15 * 60 * 1000;
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(COOKIE + "="));
  const expires = cookie ? Number(cookie.slice(COOKIE.length + 1).split(".")[0]) * 1000 : cap;
  return Number.isFinite(expires) ? Math.min(cap, expires) : cap;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hasAccess(request: Request, env: Env): Promise<boolean> {
  if (!env.API_AUTH_TOKEN) return true;
  const token = request.headers.get("Authorization")?.replace(/^Bearer +/i, "");
  if (token === env.API_AUTH_TOKEN) return true;
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(COOKIE + "="));
  if (!cookie) return false;
  const [expires, signature, extra] = cookie.slice(COOKIE.length + 1).split(".");
  if (extra || !expires || !/^[0-9]+$/.test(expires) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(expires) <= now || Number(expires) > now + LIFETIME_SECONDS) return false;
  const bytes = Uint8Array.from(signature.match(/.{2}/g)!, (byte) => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await signingKey(env.API_AUTH_TOKEN), bytes, encoder.encode("worker-mail:" + expires));
}

async function sessionCookie(request: Request, secret: string): Promise<string> {
  const expires = String(Math.floor(Date.now() / 1000) + LIFETIME_SECONDS);
  const signed = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode("worker-mail:" + expires));
  const signature = Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return COOKIE + "=" + expires + "." + signature + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + LIFETIME_SECONDS + (new URL(request.url).protocol === "https:" ? "; Secure" : "");
}

export async function sessionResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return Response.json({ ok: false }, { status: 403 });
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (request.method === "DELETE") {
    headers.set("Set-Cookie", COOKIE + "=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" + (url.protocol === "https:" ? "; Secure" : ""));
    return Response.json({ ok: true, connected: false }, { headers });
  }
  if (request.method !== "GET" && request.method !== "POST") return new Response(null, { status: 405 });

  // Auto-connect is restricted to local development; public hosts still require authentication.
  const localDevelopment = request.method === "GET" && env.APP_ENV === "development" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!localDevelopment && !(await hasAccess(request, env))) {
    return Response.json({ ok: false, connected: false }, { status: 401, headers });
  }
  if (env.API_AUTH_TOKEN && (localDevelopment || request.method === "POST")) {
    headers.set("Set-Cookie", await sessionCookie(request, env.API_AUTH_TOKEN));
  }
  return Response.json({ ok: true, connected: true }, { headers });
}
