import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const base = process.env.MAIL_TEST_URL || "http://127.0.0.1:8793";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Synthetic email is restricted to the local Worker");
const token = (await readFile(".env", "utf8")).split(/\r?\n/).find((line) => line.startsWith("API_AUTH_TOKEN=")).slice("API_AUTH_TOKEN=".length).trim();
const recipient = "live-" + randomUUID().slice(0, 8) + "@kenjaku.online";
const sockets = [];
async function api(path) {
  const response = await fetch(base + path, { headers: { Authorization: "Bearer " + token } });
  assert.equal(response.status, 200);
  return response.json();
}
function observe(to, known = "") {
  const url = new URL("/api/mail/live", base); url.protocol = "ws:"; url.searchParams.set("to", to);
  if (known) url.searchParams.set("known", known);
  const socket = new WebSocket(url, { headers: { Authorization: "Bearer " + token } }); sockets.push(socket);
  const queue = [], waiters = new Set(), changed = [];
  socket.on("error", () => {});
  socket.on("message", (bytes) => {
    const value = bytes.toString() === "pong" ? { type: "pong" } : JSON.parse(bytes.toString());
    const record = { value, time: performance.now(), size: bytes.byteLength };
    if (value.changed) changed.push(record);
    for (const waiter of waiters) if (waiter.predicate(value)) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(record); return; }
    queue.push(record);
  });
  function next(predicate, timeout = 5000) {
    const index = queue.findIndex((record) => predicate(record.value));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error("Expected live mailbox event did not arrive")); }, timeout);
      waiters.add(waiter);
    });
  }
  return { socket, next, changed };
}
async function deliver(subject, body) {
  const raw = [
    "From: Local Test <hello@example.com>", "To: " + recipient, "Subject: " + subject,
    "Date: " + new Date().toUTCString(), "Message-ID: <" + randomUUID() + "@local-test.invalid>",
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body,
  ].join("\r\n");
  const response = await fetch(base + "/cdn-cgi/local/email?from=hello@example.com&to=" + recipient, { method: "POST", body: raw });
  assert.equal(response.status, 200);
}
async function rejected(headers, expected) {
  const url = new URL("/api/mail/live?to=" + recipient, base); url.protocol = "ws:";
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers }); ws.on("error", () => {});
    ws.once("open", () => { ws.close(); reject(new Error("Unauthorized socket opened")); });
    ws.once("unexpected-response", (_, response) => {
      response.resume();
      try { assert.equal(response.statusCode, expected); resolve(); } catch (error) { reject(error); }
    });
  });
}

try {
  await rejected({}, 401);
  await rejected({ Authorization: "Bearer " + token, Origin: "https://evil.invalid" }, 403);
  await rejected({ Authorization: "Bearer " + token, "X-Mail-Session-Cap": String(Date.now() - 10000) }, 401);
  const inbox = observe(recipient), isolated = observe("other-" + recipient);
  await inbox.next((packet) => packet.type === "mailbox");
  await isolated.next((packet) => packet.type === "mailbox");
  const receive = inbox.next((packet) => packet.changed?.otp === "123456");
  const started = performance.now();
  await deliver("Sign in", "Your OTP code is 123456. Expires in 10 minutes.");
  const first = await receive, latency = first.time - started;
  assert.ok(latency < 1500, "Live delivery must not wait for a 2-second poll");
  assert.equal(first.value.changed.verification.purpose, "login");
  assert.equal(first.value.changed.to, recipient);
  inbox.socket.send("ping"); await inbox.next((packet) => packet.type === "pong");

  const largeEvent = inbox.next((packet) => packet.changed?.otp === "246810");
  await deliver("Verify your email", "Your verification code: 246810.\n" + "Large content. ".repeat(30000));
  const compact = await largeEvent;
  assert.equal(compact.value.changed.partial, true);
  assert.ok(compact.size < 100000, "OTP push must not carry a large email body");
  const body = await api("/api/mail/message?to=" + recipient + "&id=" + compact.value.changed.id);
  assert.ok(body.data.text.length > 100000, "Large body remains retrievable separately");

  const before = inbox.changed.length;
  await Promise.all(Array.from({ length: 10 }, (_, index) => deliver("Sign in", "Your OTP code is " + (700000 + index) + ".")));
  const deadline = Date.now() + 4000;
  while (inbox.changed.length < before + 10 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(inbox.changed.length, before + 10, "Every committed OTP must be pushed");
  const revisions = inbox.changed.map((record) => record.value.revision);
  for (let i = 1; i < revisions.length; i++) assert.ok(revisions[i] > revisions[i - 1]);
  assert.equal(isolated.changed.length, 0, "Mail events must not cross recipient boundaries");
  const known = (await api("/api/mail/messages?to=" + recipient)).messages[0].id;
  inbox.socket.close();
  await new Promise((resolve) => inbox.socket.once("close", resolve));
  await deliver("Sign in", "Your OTP code is 963852.");
  await deliver("Welcome discount", "6000+ generations. Your personal promo code is 888888.");
  const resumed = observe(recipient, known);
  const recovered = await resumed.next((packet) => packet.type === "mailbox");
  assert.equal(recovered.value.notification?.otp, "963852", "Reconnect must recover an OTP even if a later promotional email exists");
  const fallback = await api("/api/mail/messages?to=" + recipient + "&known=" + known);
  assert.equal(fallback.notification.otp, "963852", "HTTP fallback must recover the same missed OTP");
  console.log(JSON.stringify({ result: "PASS", localDeliveryMs: Math.round(latency), compactOtpPushBytes: compact.size, concurrentOtpEvents: 10, reconnectRecovery: true, fallbackRecovery: true, authAndIsolation: true }));
} finally {
  for (const socket of sockets) socket.terminate();
}
