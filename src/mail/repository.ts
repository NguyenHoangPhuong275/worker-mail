import type { Env } from "../config/env";
import { inboxIndexPrefix, type StoredMail } from "./storage";

export function recipientMailbox(env: Env, recipient: string) {
  if (!env.MAILBOXES) throw new Error("Mailbox storage is not configured");
  return env.MAILBOXES.get(env.MAILBOXES.idFromName(recipient.trim().toLowerCase()));
}

export async function saveMail(env: Env, mail: StoredMail, notify = true): Promise<void> {
  const response = await recipientMailbox(env, mail.to).fetch("https://mailbox/message", { method: "PUT", body: JSON.stringify(mail), headers: notify ? {} : { "X-Mail-Silent": "1" } });
  if (!response.ok) throw new Error("Email could not be stored");
}

/** Preserve existing KV messages once, with their original received timestamps. */
async function importLegacyMail(env: Env, recipient: string, box: DurableObjectStub) {
  if (env.MAIL_KV) {
    const index = await env.MAIL_KV.list({ prefix: inboxIndexPrefix(recipient), limit: 50 });
    const ids = index.keys.map((key) => (key.metadata as { id?: string })?.id).filter((id): id is string => Boolean(id));
    const messages = await Promise.all(ids.map((id) => env.MAIL_KV!.get<StoredMail>("mail:id:" + id, "json")));
    const latest = await env.MAIL_KV.get<StoredMail>("mail:latest:" + recipient.toLowerCase(), "json");
    if (latest) messages.push(latest);
    const unique = new Map(messages.filter((mail): mail is StoredMail => Boolean(mail)).map((mail) => [mail.id, mail]));
    for (const mail of unique.values()) await saveMail(env, mail, false);
    const marked = await box.fetch("https://mailbox/imported", { method: "POST" });
    if (!marked.ok) throw new Error("Mailbox migration could not be completed");
  }
}

export async function ensureMailboxImported(env: Env, recipient: string) {
  const box = recipientMailbox(env, recipient);
  if (env.MAIL_KV) {
    const response = await box.fetch("https://mailbox/imported");
    if (!response.ok) throw new Error("Mailbox migration state unavailable");
    const { imported } = await response.json<{ imported: boolean }>();
    if (!imported) await importLegacyMail(env, recipient, box);
  }
  return box;
}

export async function mailboxSnapshot(env: Env, recipient: string, known = "") {
  const box = recipientMailbox(env, recipient);
  const target = "https://mailbox/messages?known=" + encodeURIComponent(known);
  let response = await box.fetch(target);
  // The metadata header avoids decoding/copying the full email body on every poll.
  const imported = response.headers.get("X-Mail-KV-Imported");
  if (response.ok && env.MAIL_KV && imported === "false") {
    await importLegacyMail(env, recipient, box);
    response = await box.fetch(target);
  }
  return response;
}
