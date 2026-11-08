import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/mail/mailbox.ts"], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "local-durable-object", setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "stub", namespace: "local" }));
    builder.onLoad({ filter: /.*/, namespace: "local" }, () => ({ contents: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", loader: "js" }));
  } }],
});
const { Mailbox } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
globalThis.WebSocketRequestResponsePair ??= class {};

function storage(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const alarms = [], queries = [], sockets = [];
  const ctx = {
    storage: {
      sql: { exec(query, ...params) {
        queries.push(query);
        const rows = db.prepare(query).all(...params.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value));
        const rowsWritten = /^(?:INSERT|UPDATE|DELETE)\b/i.test(query) ? db.prepare("SELECT changes() AS count").get().count : 0;
        return { toArray: () => rows, one: () => rows[0], rowsWritten };
      } },
      transactionSync(fn) { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } },
      setAlarm: async (deadline) => { alarms.push(deadline); },
      deleteAlarm: async () => {},
    },
    setWebSocketAutoResponse() {}, getWebSockets: () => sockets,
  };
  return { db, ctx, alarms, queries, sockets };
}
function mail(age = 0) {
  return { id: crypto.randomUUID(), to: "reader@kenjaku.online", from: "noreply@higgsfield.ai", subject: "Verification code", text: "Your verification code: 012345.", html: "", otp: null, links: [], receivedAt: Date.now() - age };
}
const put = (box, record) => box.fetch(new Request("https://mailbox/message", { method: "PUT", body: JSON.stringify(record) }));

test("default retention preserves seven-day-old email through an alarm", async (t) => {
  const { ctx, db, alarms } = storage(t);
  const box = new Mailbox(ctx, {}), record = mail(7 * 86400000);
  assert.equal((await put(box, record)).status, 200);
  await box.alarm();
  const response = await (await box.fetch(new Request("https://mailbox/message?id=" + record.id))).json();
  assert.equal(response.data.text, record.text);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 1);
  assert.equal(alarms.length, 0, "no mail deletion alarms should be scheduled");
});

test("switching off the old expiry preserves expired rows and their body chunks", async (t) => {
  const { ctx, db } = storage(t);
  const oldBox = new Mailbox(ctx, { MAIL_RETENTION_SECONDS: "3600" }), record = mail();
  await put(oldBox, record);
  db.prepare("UPDATE messages SET expires_at = ?").run(Date.now() - 1);
  const box = new Mailbox(ctx, { MAIL_RETENTION_SECONDS: "0" });
  await box.alarm();
  const response = await (await box.fetch(new Request("https://mailbox/message?id=" + record.id))).json();
  assert.equal(response.data.text, record.text);
  assert.equal(db.prepare("SELECT expires_at FROM messages").get().expires_at, Number.MAX_SAFE_INTEGER);
});

test("positive retention still expires mail only when explicitly configured", async (t) => {
  const { ctx, db } = storage(t), box = new Mailbox(ctx, { MAIL_RETENTION_SECONDS: "60" });
  const stale = await (await put(box, mail(90000))).json();
  assert.equal(stale.expired, true);
  await put(box, mail());
  db.prepare("UPDATE messages SET expires_at = ?").run(Date.now() - 1);
  await box.alarm();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chunks").get().count, 0);
});

test("invalid retention values are rejected before touching mail", (t) => {
  for (const value of ["-1", "bad", "1.5", "31536001"]) {
    const { ctx } = storage(t);
    assert.throws(() => new Mailbox(ctx, { MAIL_RETENTION_SECONDS: value }), /MAIL_RETENTION_SECONDS/);
  }
});

test("one committed OTP shares one mailbox query across twelve subscribers", async (t) => {
  const { ctx, queries, sockets } = storage(t);
  const box = new Mailbox(ctx, {}), previous = mail(10000);
  await put(box, previous);
  const events = [];
  for (let i = 0; i < 12; i++) sockets.push({
    readyState: 1, deserializeAttachment: () => ({ expiresAt: Date.now() + 60000, known: previous.id }),
    send: (packet) => events.push(JSON.parse(packet)),
  });
  queries.length = 0;
  const incoming = { ...mail(), text: "Your verification code: 345678.\n" + "Thông tin chi tiết. ".repeat(10000) };
  await put(box, incoming);
  assert.equal(events.length, 12);
  assert.ok(events.every((event) => event.changed.otp === "345678" && event.changed.partial));
  assert.equal(queries.filter((query) => /^SELECT (?:id, )?summary FROM messages/.test(query)).length, 1);
  assert.equal(queries.filter((query) => query.startsWith("SELECT data FROM chunks")).length, 0, "newly committed mail is already available without reading its body again");
  assert.equal(new Set(events.map((event) => event.revision)).size, 1);
});

test("mailbox listing uses the received-time index as the mailbox grows", async (t) => {
  const { ctx, db } = storage(t);
  const box = new Mailbox(ctx, {});
  for (let i = 0; i < 65; i++) await put(box, mail(i * 1000));
  const snapshot = await (await box.fetch(new Request("https://mailbox/messages"))).json();
  assert.equal(snapshot.messages.length, 50);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 65, "display limit must never delete older mail");
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT summary FROM messages WHERE expires_at > ? ORDER BY received_at DESC, id DESC LIMIT 50").all(Date.now());
  assert.ok(plan.some((row) => row.detail.includes("messages_received")));
  assert.ok(plan.every((row) => !row.detail.includes("TEMP B-TREE")));
});
