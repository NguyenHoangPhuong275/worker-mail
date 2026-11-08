import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function moduleFrom(path) {
  const code = (await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "esm" })).outputFiles[0].text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
const { mailboxSnapshot, saveMail } = await moduleFrom("src/mail/repository.ts");
const { mailApiResponse } = await moduleFrom("src/http/mail-api.ts");
const { extractVerificationCode, analyzeVerification, normalizeVerification } = await moduleFrom("src/mail/otp.ts");
const recipient = "legacy@kenjaku.online";
const receivedAt = Date.now() - 100000;
const legacy = { id: "old-id", from: "hello@example.com", to: recipient, subject: "Old mail", text: "Old body", html: "", links: [], otp: null, receivedAt };

test("legacy KV mail is preserved once and keeps its original expiration timestamp", async () => {
  const messages = new Map([["new-id", { ...legacy, id: "new-id", receivedAt: Date.now() }]]);
  let imported = false, indexReads = 0, writes = 0;
  const box = { async fetch(url, init) {
    if (init?.method === "PUT") { const mail = JSON.parse(init.body); messages.set(mail.id, mail); writes++; return Response.json({ ok: true }); }
    if (url.endsWith("/imported")) { imported = true; return Response.json({ ok: true }); }
    const rows = [...messages.values()].sort((a, b) => b.receivedAt - a.receivedAt);
    return Response.json({ ok: true, messages: rows, data: rows[0], imported }, { headers: { "X-Mail-KV-Imported": String(imported) } });
  } };
  const env = {
    MAILBOXES: { idFromName: (name) => name, get: () => box },
    MAIL_KV: {
      list: async () => { indexReads++; return { keys: [{ metadata: { id: legacy.id } }] }; },
      get: async () => legacy,
    },
  };
  const snapshot = await (await mailboxSnapshot(env, recipient)).json();
  assert.equal(snapshot.messages.length, 2);
  assert.equal(messages.get(legacy.id).receivedAt, receivedAt);
  assert.equal(messages.get(legacy.id).text, "Old body");
  assert.equal(writes, 1, "duplicated KV latest/index entries should import only once");
  await mailboxSnapshot(env, recipient);
  assert.equal(indexReads, 1, "subsequent polling must not depend on KV");
});

test("incoming email is not acknowledged when its authoritative write fails", async () => {
  const env = { MAILBOXES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response("Failed", { status: 500 }) }) } };
  await assert.rejects(saveMail(env, legacy), /could not be stored/);
});

test("routine polling returns the existing response without parsing or cloning its body", async () => {
  const response = Response.json({ ok: true }, { headers: { "X-Mail-KV-Imported": "true" } });
  response.clone = () => { throw new Error("Full body should not be cloned"); };
  response.json = () => { throw new Error("Full body should not be decoded"); };
  const env = {
    MAILBOXES: { idFromName: (name) => name, get: () => ({ fetch: async () => response }) },
    MAIL_KV: { list: () => { throw new Error("Imported mailbox should not read legacy KV"); } },
  };
  assert.equal(await mailboxSnapshot(env, recipient), response);
});

test("opening one email checks migration metadata without loading another email body", async () => {
  const calls = [], id = "c7fe9e81-841c-484b-b8a8-6d4ba06e6ba7";
  const env = {
    MAIL_KV: {},
    MAILBOXES: { idFromName: (name) => name, get: () => ({ async fetch(url) {
      calls.push(url);
      if (url === "https://mailbox/imported") return Response.json({ ok: true, imported: true });
      if (url === "https://mailbox/message?id=" + id) return Response.json({ ok: true, data: legacy });
      throw new Error("Unexpected full mailbox read");
    } }) },
  };
  const response = await mailApiResponse(new Request("https://example.com/api/mail/message?to=" + recipient + "&id=" + id), env);
  assert.equal((await response.json()).data.id, legacy.id);
  assert.equal(calls.length, 2);
});

test("OTP detection does not mislabel ordinary receipts or tracking numbers", () => {
  assert.equal(extractVerificationCode("335689 is your verification code", ""), "335689");
  assert.equal(extractVerificationCode("Sign in", "Your OTP is 482 916."), "482916");
  assert.equal(extractVerificationCode("Receipt 20261107", "Order number 123456, thank you for shopping."), null);
  assert.equal(extractVerificationCode("Newsletter", "Your personal discount is 55%, campaign 982137."), null);
  assert.equal(extractVerificationCode("Đăng nhập", "Mã xác nhận của bạn: 724891."), "724891");
});

test("contextual OTP detection recognizes explicit numeric and alphanumeric security codes", () => {
  const cases = [
    ["335689 is your verification code", "335689 is your OTP code for Higgsfield AI.", "335689"],
    ["Your single-use code", "Your single-use code is 972641.", "972641"],
    ["Email confirmation", "Your confirmation code: 853127", "853127"],
    ["Sign in", "Your code: AB12CD", "AB12CD"],
    ["Đăng nhập", "Mã xác minh: 12 34 56", "123456"],
    ["Security", "Your OTP is 482-916.", "482916"],
    ["Login", "Your login code: 123456. Enter 123456 to continue.", "123456"],
  ];
  for (const [subject, body, expected] of cases) assert.equal(extractVerificationCode(subject, body), expected, subject);
});

test("promotional, order, PIN, URL, quoted and ambiguous numbers are not guessed as OTP", () => {
  const cases = [
    ["Welcome to Higgsfield. Pro features unlocked for the next 3 hours!", "6000+ generations. Your personal code: kira_PERSONAL_PROMO. Claim your 55% discount."],
    ["Your discount", "Your code: 123456. Expires in 10 minutes."],
    ["Sign in for your discount", "Your code: 123456"],
    ["Your card PIN", "Your PIN: 1234"],
    ["Invoice 982137", "Your order reference 132546 costs $123456."],
    ["Sign in", "https://example.com/?verification_code=123456"],
    ["Re: Hello", "On Saturday someone wrote:\nYour OTP code is 123456"],
    ["Sign in", "Your OTP code is 123456 or 654321"],
    ["Sign in", "Your OTP is 123456. Your OTP is 654321."],
    ["Sign in", "Your previous OTP code is 123456."],
    ["Sign in", "Your OTP code 123456 has expired."],
    ["Sign in", "Your code is 1234567890."],
  ];
  for (const [subject, body] of cases) assert.equal(extractVerificationCode(subject, body), null, subject + ": " + body);
  assert.equal(analyzeVerification("Sign in", "Your OTP code is 123456 or 654321").status, "ambiguous");
  assert.equal(analyzeVerification("Sign in", "", '<a href="https://example.com/?otp=123456">Continue</a><script>OTP 654321</script>').code, null);
  assert.equal(analyzeVerification("Sign in", "", '<p>Your verification code:</p><strong>123456</strong>').code, "123456");
});

test("purpose follows the actual subject and explicit expiry, without inventing a lifetime", () => {
  const now = 1_000_000;
  const login = analyzeVerification("Sign in to Example", "Your OTP is 123456. Expires in 10 minutes.", "", now, now);
  assert.equal(login.purpose, "login"); assert.equal(login.expiresAt, now + 600000);
  assert.equal(analyzeVerification("Verify your email", "Your code: 123456", "", now, now).purpose, "email");
  assert.equal(analyzeVerification("Reset your password", "Your reset code: 123456", "", now, now).purpose, "password_reset");
  assert.equal(analyzeVerification("Sign in", "Your code: 123456", "", now, now).expiresAt, null);
  assert.equal(analyzeVerification("Sign in", "Your OTP is 123456. Expires in 10 minutes.", "", now, now + 600001).status, "expired");
  const old = normalizeVerification({ ...legacy, subject: "Your discount", text: "6000+ generations. Your personal code: 555555.", otp: "6000" });
  assert.equal(old.otp, null, "previously stored false positives must be corrected on read");
});
