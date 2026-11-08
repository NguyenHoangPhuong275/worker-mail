import type { Env } from "../config/env";
import { ensureMailboxImported, mailboxSnapshot } from "../mail/repository";
import type { StoredMail } from "../mail/storage";
import { liveSessionDeadline } from "./session";
import { json } from "./response";

export async function mailApiResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!env.MAILBOXES) return json({ ok: false, error: "Mailbox storage unavailable" }, 503);
  const to = url.searchParams.get("to")?.trim().toLowerCase();
  if (url.pathname === "/api/mail/message") {
    const id = url.searchParams.get("id") || "";
    if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ ok: false, error: "Invalid message id" }, 400);
    if (to) {
      const box = await ensureMailboxImported(env, to);
      return box.fetch("https://mailbox/message?id=" + encodeURIComponent(id));
    }
    const legacy = await env.MAIL_KV?.get<StoredMail>("mail:id:" + id, "json");
    if (legacy) {
      const box = await ensureMailboxImported(env, legacy.to);
      return box.fetch("https://mailbox/message?id=" + encodeURIComponent(id));
    }
    return json({ ok: false, error: "Recipient required" }, 400);
  }
  if (!to || !/^[^\s@]+@[^\s@]+$/.test(to)) return json({ ok: false, error: "Invalid recipient" }, 400);
  if (url.pathname === "/api/mail/live") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ ok: false, error: "WebSocket required" }, 426);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ ok: false, error: "Invalid origin" }, 403);
    const box = await ensureMailboxImported(env, to);
    const forwardedCap = Number(request.headers.get("X-Mail-Session-Cap") || Infinity);
    return box.fetch("https://mailbox/live?known=" + encodeURIComponent(url.searchParams.get("known") || ""), {
      headers: { Upgrade: "websocket", "X-Session-Deadline": String(Math.min(liveSessionDeadline(request), forwardedCap)) },
    });
  }
  if (url.pathname === "/api/mail/messages") return mailboxSnapshot(env, to, url.searchParams.get("known") || "");
  if (url.pathname === "/api/mail/latest" || url.pathname === "/api/mail/otp") {
    const result = await mailboxSnapshot(env, to);
    const snapshot = await result.json<{ data: StoredMail | null }>();
    if (!snapshot.data) return json({ ok: false, error: "No email found for this address" }, 404);
    if (url.pathname === "/api/mail/otp") {
      return json({ ok: true, to: snapshot.data.to, otp: snapshot.data.otp, verification: snapshot.data.verification, receivedAt: snapshot.data.receivedAt });
    }
    return json({ ok: true, data: snapshot.data });
  }
  return json({ ok: false, error: "Not found" }, 404);
}
