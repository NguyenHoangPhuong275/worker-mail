import { DurableObject } from "cloudflare:workers";
import type { Env } from "../config/env";
import type { StoredMail } from "./storage";
import { normalizeVerification } from "./otp";
import { liveMail } from "./live-payload";
import { MailboxStore, type MailboxSnapshot } from "./mailbox-store";
import { json } from "../http/response";

type LiveSession = { expiresAt: number; known: string };

/** One authoritative mailbox per recipient; storage commits before push. */
export class Mailbox extends DurableObject<Env> {
  private readonly store: MailboxStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new MailboxStore(ctx.storage, env.MAIL_RETENTION_SECONDS);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private session(socket: WebSocket): LiveSession | null {
    const session = socket.deserializeAttachment() as LiveSession | null;
    if (session && session.expiresAt > Date.now()) return session;
    socket.close(1008, "Session expired");
    return null;
  }

  private sendState(socket: WebSocket, snapshots: (known: string) => MailboxSnapshot, changed: StoredMail | null = null) {
    try {
      const session = this.session(socket);
      if (!session) return;
      const snapshot = snapshots(session.known);
      socket.send(JSON.stringify({ type: "mailbox", ...snapshot, data: liveMail(snapshot.data), notification: liveMail(snapshot.notification), changed: liveMail(changed), expiresAt: session.expiresAt, sentAt: Date.now() }));
    } catch { try { socket.close(1011, "Reconnect"); } catch {} }
  }

  private broadcast(changed?: StoredMail) {
    const sockets = this.ctx.getWebSockets().filter((socket) => socket.readyState === 1);
    if (!sockets.length) return;
    const snapshots = this.store.snapshots(changed);
    for (const socket of sockets) this.sendState(socket, snapshots, changed);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const session = this.session(socket);
    if (!session) return;
    if (typeof message !== "string" || message.length > 512) { socket.close(1009, "Invalid message"); return; }
    try {
      const packet = JSON.parse(message);
      if (packet.type === "ack" && typeof packet.id === "string" && this.store.has(packet.id)) {
        socket.serializeAttachment({ ...session, known: packet.id });
      } else if (packet.type === "sync") this.sendState(socket, this.store.snapshots());
    } catch { socket.close(1003, "Invalid message"); }
  }
  webSocketClose(socket: WebSocket, code: number) { try { socket.close(code === 1005 || code === 1006 ? 1000 : code); } catch {} }
  webSocketError(socket: WebSocket) { try { socket.close(1011, "Reconnect"); } catch {} }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/live") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ ok: false }, 426);
      const expiresAt = Math.min(Number(request.headers.get("X-Session-Deadline")), Date.now() + 15 * 60 * 1000);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return json({ ok: false }, 401);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ expiresAt, known: url.searchParams.get("known") || "" });
      this.sendState(server, this.store.snapshots());
      await this.scheduleAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/message" && request.method === "PUT") {
      const mail = normalizeVerification(await request.json<StoredMail>());
      if (!mail.id || !mail.to || !Number.isFinite(mail.receivedAt)) return json({ ok: false }, 400);
      if (!this.store.put(mail)) return json({ ok: true, expired: true });
      if (request.headers.get("X-Mail-Silent") !== "1") this.broadcast(mail);
      await this.scheduleAlarm();
      return json({ ok: true });
    }
    if (url.pathname === "/imported") {
      if (request.method === "POST") this.store.markImported();
      return json({ ok: true, imported: this.store.imported });
    }
    if (url.pathname === "/message") {
      const data = this.store.read(url.searchParams.get("id") || "");
      return json(data ? { ok: true, data } : { ok: false, error: "Email not found or expired" }, data ? 200 : 404);
    }
    const snapshot = this.store.snapshots()(url.searchParams.get("known") || "");
    return json(snapshot, 200, { "X-Mail-KV-Imported": String(snapshot.imported) });
  }

  private async scheduleAlarm() {
    const deadlines = this.ctx.getWebSockets().filter((socket) => socket.readyState === 1).map((socket) => (socket.deserializeAttachment() as LiveSession).expiresAt);
    const expiry = this.store.nextExpiry();
    if (expiry !== null) deadlines.push(expiry);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    this.store.expire();
    this.broadcast();
    await this.scheduleAlarm();
  }
}
