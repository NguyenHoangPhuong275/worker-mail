import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { requestJson } from "../public/assets/api-client.js";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const bundle = (await build({ entryPoints: ["public/assets/app.js"], bundle: true, write: false, format: "iife", logLevel: "silent" })).outputFiles[0].text;
const address = "kirano962244@banker-thaovy3.tokyo";
const addressModule = (await build({ entryPoints: ["src/mail/address.ts"], bundle: true, write: false, format: "esm", platform: "node" })).outputFiles[0].text;
const { readInboundMail } = await import("data:text/javascript;base64," + Buffer.from(addressModule).toString("base64"));
const mail = (id, values = {}) => ({ id, to: address, from: "Example <hello@example.com>", subject: "Ordinary email", text: "Hello, this is a normal email.", receivedAt: Date.now(), otp: null, links: [], ...values });
const snapshot = (messages) => ({ ok: true, messages, data: messages[0] || null });
async function waitFor(condition) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.fail("UI did not settle");
}
function page({ url = "https://mail.example/?to=" + address, initial = [], saved = "", failure = false, live = false, domains = [address.split("@")[1]], configReady = Promise.resolve() } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const sockets = [];
  w.WebSocket = live ? class {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    open() { this.readyState = 1; this.onopen?.(); }
    push(packet) { this.onmessage?.({ data: JSON.stringify({ type: "mailbox", ok: true, expiresAt: Date.now() + 600000, ...packet }) }); }
  } : undefined;
  let messages = initial, poll;
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => "blob:attachment"; w.URL.revokeObjectURL = () => {};
  w.setInterval = (callback, delay) => { if (delay === 1000 || delay === 2000) poll = callback; return 1; };
  w.clearInterval = () => {};
  if (saved) w.localStorage.setItem("worker-mail-current-inbox", saved);
  w.fetch = async (path) => {
    let data, status = 200;
    if (path.startsWith("/api/session")) data = { ok: true, connected: true };
    else if (path.startsWith("/api/console")) { await configReady; data = { ok: true, domains }; }
    else if (path.startsWith("/api/mail/messages")) { data = snapshot(messages); if (failure) { status = 503; data = { ok: false }; } }
    else if (path.startsWith("/api/mail/message?")) data = { ok: true, data: messages.find((m) => m.id === new URL(path, w.location).searchParams.get("id")) };
    else throw new Error("Unexpected path " + path);
    return { ok: status === 200, status, json: async () => data };
  };
  w.eval(bundle);
  return { dom, w, sockets, setMessages: (value) => { messages = value; }, poll: () => poll?.() };
}

test("received non-OTP mail opens directly and remains visible after F5", async () => {
  const received = mail("first");
  const first = page({ initial: [received] });
  await waitFor(() => !first.w.document.getElementById("reader-view").hidden);
  assert.equal(first.w.document.getElementById("reader-body").textContent, received.text);
  assert.equal(first.w.document.getElementById("otp-box").hidden, true);
  const url = first.w.location.href, saved = first.w.localStorage.getItem("worker-mail-current-inbox");
  first.w.close();
  const reloaded = page({ url, saved, initial: [received] });
  try {
    await waitFor(() => !reloaded.w.document.getElementById("reader-view").hidden);
    assert.equal(reloaded.w.document.getElementById("current-address").textContent, address);
    assert.equal(reloaded.w.document.getElementById("reader-body").textContent, received.text);
  } finally { reloaded.w.close(); }
});

test("saved mailbox is restored without a query and old preview links open real mail", async () => {
  const p = page({ url: "https://mail.example/?preview=1", saved: address, initial: [mail("saved")] });
  try {
    await waitFor(() => !p.w.document.getElementById("reader-view").hidden);
    assert.equal(p.w.document.getElementById("current-address").textContent, address);
    assert.equal(new URL(p.w.location.href).searchParams.get("preview"), null);
    assert.equal(p.w.document.querySelector("#toggle-preview"), null);
  } finally { p.w.close(); }
});

test("new addresses rotate configured domains and immediately copy the newly displayed address", async () => {
  const domains = ["one.mail.test", "two.mail.test", "three.mail.test"];
  const p = page({ domains });
  const copied = [];
  p.w.navigator.clipboard = { writeText: async (value) => { copied.push(value); } };
  try {
    const button = p.w.document.getElementById("new-address");
    await waitFor(() => !button.disabled);
    assert.deepEqual([...p.w.document.getElementById("domain-select").options].map((option) => option.value), domains);
    let previous = p.w.document.getElementById("current-address").textContent;
    for (let i = 0; i < 20; i++) {
      button.click();
      const next = p.w.document.getElementById("current-address").textContent;
      assert.ok(domains.includes(next.split("@")[1]));
      assert.notEqual(next.split("@")[1], previous.split("@")[1]);
      assert.equal(new URL(p.w.location.href).searchParams.get("to"), next);
      assert.equal(copied.at(-1), next, "clipboard must contain the new address, not the previous mailbox");
      previous = next;
    }
    await waitFor(() => p.w.document.getElementById("toast").textContent === "Đã tạo và sao chép địa chỉ mới.");
  } finally { p.w.close(); }
});

test("a single configured domain still creates a different email and survives reload", async () => {
  const domains = ["only.mail.test"];
  const p = page({ domains });
  let saved;
  try {
    const button = p.w.document.getElementById("new-address");
    await waitFor(() => !button.disabled);
    const previous = p.w.document.getElementById("current-address").textContent;
    button.click(); saved = p.w.document.getElementById("current-address").textContent;
    assert.notEqual(saved, previous);
    assert.equal(saved.split("@")[1], domains[0]);
  } finally { p.w.close(); }
  const reloaded = page({ url: "https://mail.example/", saved, domains });
  try {
    await waitFor(() => !reloaded.w.document.getElementById("new-address").disabled);
    assert.equal(reloaded.w.document.getElementById("current-address").textContent, saved);
  } finally { reloaded.w.close(); }
});

test("no email is generated before domain configuration arrives or when it is empty", async () => {
  let release;
  const configReady = new Promise((resolve) => { release = resolve; });
  const p = page({ domains: [], configReady });
  try {
    assert.equal(p.w.document.getElementById("new-address").disabled, true);
    assert.equal(p.w.localStorage.getItem("worker-mail-current-inbox"), null);
    release();
    await waitFor(() => p.w.document.getElementById("status-text").textContent === "Kết nối gián đoạn");
    assert.equal(p.w.document.getElementById("new-address").disabled, true);
    assert.equal(p.w.document.getElementById("domain-select").options.length, 0);
    assert.equal(p.w.localStorage.getItem("worker-mail-current-inbox"), null);
  } finally { p.w.close(); }
});

test("new incoming HTML mail automatically replaces latest body without clicking", async () => {
  const p = page({ initial: [mail("old")] });
  try {
    await waitFor(() => !p.w.document.getElementById("reader-view").hidden);
    p.setMessages([mail("new", { subject: "A newsletter", text: "", html: "<h1>Newsletter</h1><p>Visible HTML content</p>" }), mail("old")]);
    await p.poll();
    await waitFor(() => p.w.document.getElementById("reader-subject").textContent === "A newsletter");
    assert.match(p.w.document.querySelector("#reader-body iframe").srcdoc, /Visible HTML content/);
    assert.equal(p.w.document.getElementById("message-count").textContent, "2");
    assert.equal(p.w.document.getElementById("otp-box").hidden, true);
  } finally { p.w.close(); }
});

test("HTML cannot run scripts, navigate frames, submit forms or load remote trackers", async () => {
  const p = page({ initial: [mail("html", { text: "", html: '<meta http-equiv="refresh" content="0;url=https://evil.invalid"><script>alert(1)</script><iframe src="https://evil.invalid"></iframe><form action="https://evil.invalid"><input></form><img src="https://evil.invalid/pixel" onerror="alert(1)"><p>Safe text</p><a href="javascript:alert(1)">bad link</a>', attachments: [{ filename: "note.txt", mimeType: "text/plain", contentId: null, content: "aGVsbG8=" }] })] });
  try {
    await waitFor(() => !p.w.document.getElementById("reader-view").hidden);
    const frame = p.w.document.querySelector("#reader-body iframe"), doc = new JSDOM(frame.srcdoc).window.document;
    assert.equal(doc.querySelector("script,iframe,form,input"), null);
    assert.equal(doc.querySelector("img").getAttribute("src"), null);
    assert.equal(doc.querySelector("a").getAttribute("href"), null);
    assert.match(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /default-src 'none'/);
    assert.equal(frame.sandbox?.contains?.("allow-scripts") || frame.getAttribute("sandbox").includes("allow-scripts"), false);
    assert.equal(p.w.document.querySelector("#reader-attachments a").download, "note.txt");
  } finally { p.w.close(); }
});

test("a failed request shows a connection error rather than claiming the mailbox is empty", async () => {
  const p = page({ failure: true });
  try {
    await waitFor(() => p.w.document.getElementById("status-text").textContent.includes("kết nối lại"));
    assert.doesNotMatch(p.w.document.getElementById("empty-title").textContent, /trống/);
  } finally { p.w.close(); }
});

test("hung requests time out so polling can recover", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  try { await assert.rejects(requestJson("https://example.invalid", { timeout: 20 }), { name: "AbortError" }); }
  finally { globalThis.fetch = original; }
});

test("mail envelope accepts null senders used by delivery reports", () => {
  const mail = readInboundMail({ from: "", to: address });
  assert.equal(mail.from, "");
  assert.equal(mail.to, address);
});

test("OTP label and copying belong only to the selected verification email", async () => {
  const verification = { version: 2, status: "detected", code: "123456", purpose: "login", label: "Mã đăng nhập", expiresAt: null };
  const login = mail("login", { otp: "123456", verification, subject: "Sign in" });
  const p = page({ initial: [login] });
  const copied = [];
  p.w.navigator.clipboard = { writeText: async (value) => { copied.push(value); } };
  try {
    await waitFor(() => !p.w.document.getElementById("otp-box").hidden);
    assert.equal(p.w.document.getElementById("otp-label").textContent, "Mã đăng nhập");
    assert.match(p.w.document.getElementById("otp-context").textContent, /Nhận lúc/);
    p.w.document.getElementById("copy-otp").click();
    assert.deepEqual(copied, ["123456"]);
    p.setMessages([mail("promo", { subject: "Discount", otp: "6000" }), login]);
    await p.poll();
    await waitFor(() => p.w.document.getElementById("reader-subject").textContent === "Discount");
    assert.equal(p.w.document.getElementById("otp-box").hidden, true);
    assert.equal(p.w.document.getElementById("copy-otp").disabled, true);
    p.w.document.getElementById("copy-otp").dispatchEvent(new p.w.Event("click"));
    assert.deepEqual(copied, ["123456"], "an ordinary email must not reuse a previous or unverified code");
  } finally { p.w.close(); }
});

test("ambiguous codes remain in email body without an automatic OTP choice", async () => {
  const p = page({ initial: [mail("ambiguous", { text: "Your OTP is 123456 or 654321", verification: { version: 2, status: "ambiguous", code: null, expiresAt: null } })] });
  try {
    await waitFor(() => !p.w.document.getElementById("reader-view").hidden);
    assert.equal(p.w.document.getElementById("otp-box").hidden, true);
    assert.equal(p.w.document.getElementById("copy-otp").disabled, true);
    assert.match(p.w.document.getElementById("otp-notice").textContent, /nhiều mã/);
    assert.match(p.w.document.getElementById("reader-body").textContent, /123456 or 654321/);
  } finally { p.w.close(); }
});

test("an explicitly expired OTP stops being copyable while its email remains visible", async () => {
  const expiresAt = Date.now() + 200;
  const p = page({ initial: [mail("expires", { otp: "123456", verification: { version: 2, status: "detected", code: "123456", label: "Mã đăng nhập", purpose: "login", expiresAt } })] });
  try {
    await waitFor(() => !p.w.document.getElementById("otp-box").hidden);
    await waitFor(() => !p.w.document.getElementById("otp-notice").hidden);
    assert.equal(p.w.document.getElementById("otp-box").hidden, true);
    assert.equal(p.w.document.getElementById("copy-otp").disabled, true);
    assert.equal(p.w.document.getElementById("reader-view").hidden, false);
    assert.match(p.w.document.getElementById("otp-notice").textContent, /hết hạn/);
  } finally { p.w.close(); }
});

test("push displays a new OTP immediately without waiting for polling or a large body", async () => {
  const p = page({ initial: [], live: true });
  const info = { version: 2, status: "detected", code: "654321", purpose: "login", label: "Mã đăng nhập", expiresAt: null };
  try {
    await waitFor(() => p.sockets.length === 1);
    const socket = p.sockets[0]; socket.open();
    const incoming = mail("push-otp", { otp: "654321", verification: info, partial: true, text: "Đang tải nội dung thư…" });
    p.setMessages([{ ...incoming, partial: false, text: "Full body loaded" }]);
    socket.push({ revision: 1, messages: [incoming], changed: incoming, data: incoming });
    assert.equal(p.w.document.getElementById("otp-box").hidden, false);
    assert.equal(p.w.document.getElementById("otp-value").textContent, "654321");
    assert.equal(p.w.document.getElementById("otp-label").textContent, "Mã đăng nhập");
    await waitFor(() => p.w.document.getElementById("reader-body").textContent === "Full body loaded");
    const promo = mail("promo-after", { otp: "6000", subject: "Discount" });
    socket.push({ revision: 2, messages: [promo, incoming], data: promo, changed: promo });
    assert.equal(p.w.document.getElementById("otp-value").textContent, "654321", "a later promotion must not hide the new OTP");
    assert.equal(p.w.document.getElementById("reader-subject").textContent, incoming.subject);
    assert.match(socket.sent.join(" "), /ack/);
    socket.push({ revision: 0, messages: [], data: null });
    assert.equal(p.w.document.getElementById("otp-box").hidden, false, "a stale snapshot must not wipe a newer push");
  } finally { p.w.close(); }
});

test("reconnected push recovers a missed OTP and old sockets cannot change another mailbox", async () => {
  const old = mail("old"), p = page({ initial: [old], live: true });
  const info = { version: 2, status: "detected", code: "963852", purpose: "login", label: "Mã đăng nhập", expiresAt: null };
  try {
    await waitFor(() => p.sockets.length === 1 && !p.w.document.getElementById("reader-view").hidden);
    const socket = p.sockets[0]; socket.open();
    const otp = mail("missed", { otp: "963852", verification: info }), promo = mail("later-promo");
    socket.push({ revision: 3, messages: [promo, otp, old], data: promo, notification: otp });
    assert.equal(p.w.document.getElementById("otp-value").textContent, "963852");
    p.w.document.getElementById("new-address").click();
    assert.equal(socket.readyState, 3);
    assert.equal(p.w.document.getElementById("otp-box").hidden, true);
    assert.notEqual(p.w.document.getElementById("current-address").textContent, address);
  } finally { p.w.close(); }
});

test("the browser reconnects automatically and supplies its last known message for replay", async () => {
  const old = mail("last-seen"), p = page({ initial: [old], live: true });
  try {
    await waitFor(() => p.sockets.length === 1 && !p.w.document.getElementById("reader-view").hidden);
    const first = p.sockets[0]; first.open();
    first.push({ revision: 1, messages: [old], data: old });
    first.onclose({ code: 1006 });
    await waitFor(() => p.sockets.length === 2);
    const resumed = p.sockets[1];
    assert.equal(new URL(resumed.url).searchParams.get("known"), "last-seen");
    resumed.open();
    const info = { version: 2, status: "detected", code: "147258", purpose: "login", label: "Mã đăng nhập", expiresAt: null };
    const otp = mail("replayed", { otp: "147258", verification: info });
    resumed.push({ revision: 3, messages: [mail("promo"), otp, old], data: mail("promo"), notification: otp });
    assert.equal(p.w.document.getElementById("otp-value").textContent, "147258");
    assert.equal(p.w.document.getElementById("otp-box").hidden, false);
    assert.equal(p.w.document.getElementById("status-text").textContent, "Nhận trực tiếp");
  } finally { p.w.close(); }
});

test("HTTP fallback keeps receiving OTP while the push connection is unavailable", async () => {
  const p = page({ initial: [mail("old")], live: true });
  try {
    await waitFor(() => !p.w.document.getElementById("reader-view").hidden);
    const info = { version: 2, status: "detected", code: "456789", purpose: "email", label: "Mã xác minh email", expiresAt: null };
    p.setMessages([mail("fallback", { otp: "456789", verification: info })]);
    await p.poll();
    await waitFor(() => !p.w.document.getElementById("otp-box").hidden);
    assert.equal(p.w.document.getElementById("otp-box").hidden, false);
    assert.equal(p.w.document.getElementById("otp-value").textContent, "456789");
    assert.equal(p.w.document.getElementById("otp-label").textContent, "Mã xác minh email");
  } finally { p.w.close(); }
});
