import { normalizeVerification, type Verification } from "./otp";
import { summarizeMail, type InboxMessage, type StoredMail } from "./storage";

const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;
const CHUNK_SIZE = 64_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** SQLite and retention only; no HTTP or socket lifecycle here. */
export class MailboxStore {
  private readonly retentionMs: number;

  constructor(private readonly storage: DurableObjectStorage, retentionSeconds = "0") {
    const seconds = Number(retentionSeconds);
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 31_536_000) {
      throw new Error("MAIL_RETENTION_SECONDS must be 0 (keep mail) or up to 31536000 seconds");
    }
    this.retentionMs = seconds * 1000;
    const sql = storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, summary TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS messages_received ON messages(received_at DESC, id DESC)");
    sql.exec("CREATE TABLE IF NOT EXISTS chunks (message_id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(message_id,part))");
    sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    if (this.setting("retention-seconds") !== String(seconds)) {
      storage.transactionSync(() => {
        if (seconds === 0) sql.exec("UPDATE messages SET expires_at = ?", NEVER_EXPIRES);
        else sql.exec("UPDATE messages SET expires_at = received_at + ?", this.retentionMs);
        sql.exec("INSERT OR REPLACE INTO settings VALUES ('retention-seconds', ?)", String(seconds));
      });
    }
  }

  private setting(key: string) {
    return this.storage.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value;
  }

  get imported() { return this.setting("kv-imported") === "1"; }
  markImported() { this.storage.sql.exec("INSERT OR REPLACE INTO settings VALUES ('kv-imported','1')"); }
  has(id: string) { return this.storage.sql.exec("SELECT id FROM messages WHERE id = ?", id).toArray().length > 0; }

  read(id: string): StoredMail | null {
    const rows = this.storage.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM chunks WHERE message_id = ? AND EXISTS (SELECT 1 FROM messages WHERE id = ? AND expires_at > ?) ORDER BY part", id, id, Date.now()).toArray();
    if (!rows.length) return null;
    const parts = rows.map((row) => new Uint8Array(row.data));
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return normalizeVerification(JSON.parse(decoder.decode(bytes)));
  }

  put(mail: StoredMail & { verification: Verification }) {
    const expiresAt = this.retentionMs === 0 ? NEVER_EXPIRES : mail.receivedAt + this.retentionMs;
    if (expiresAt <= Date.now()) return false;
    const bytes = encoder.encode(JSON.stringify(mail));
    this.storage.transactionSync(() => {
      this.storage.sql.exec("INSERT OR REPLACE INTO messages VALUES (?, ?, ?, ?)", mail.id, mail.receivedAt, expiresAt, JSON.stringify(summarizeMail(mail)));
      this.storage.sql.exec("DELETE FROM chunks WHERE message_id = ?", mail.id);
      for (let offset = 0, part = 0; offset < bytes.byteLength; offset += CHUNK_SIZE, part++) {
        this.storage.sql.exec("INSERT INTO chunks VALUES (?, ?, ?)", mail.id, part, bytes.slice(offset, offset + CHUNK_SIZE).buffer);
      }
      this.incrementRevision();
    });
    return true;
  }

  private incrementRevision() {
    this.storage.sql.exec("INSERT INTO settings VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1");
  }

  /** Share one list and body cache across subscribers, then release after this operation. */
  snapshots(changed?: StoredMail) {
    const now = Date.now();
    const rows = this.storage.sql.exec<{ summary: string }>("SELECT summary FROM messages WHERE expires_at > ? ORDER BY received_at DESC, id DESC LIMIT 50", now).toArray();
    const messages = rows.map(({ summary: raw }) => {
      const mail = JSON.parse(raw) as InboxMessage;
      if (mail.verification?.version !== 2 || mail.verification.status !== "detected") mail.otp = null;
      if (mail.verification?.expiresAt && mail.verification.expiresAt <= now) {
        mail.otp = null; mail.verification = { ...mail.verification, status: "expired", code: null };
      }
      return mail;
    });
    const settings = new Map(this.storage.sql.exec<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('revision','kv-imported')").toArray().map(({ key, value }) => [key, value]));
    const revision = Number(settings.get("revision") || "0"), imported = settings.get("kv-imported") === "1";
    const bodies = new Map<string, StoredMail | null>();
    if (changed) bodies.set(changed.id, changed);
    const read = (id?: string) => {
      if (!id) return null;
      if (!bodies.has(id)) bodies.set(id, this.read(id));
      return bodies.get(id)!;
    };
    return (known = "") => {
      const knownTime = messages.find((mail) => mail.id === known)?.receivedAt ?? (known
        ? this.storage.sql.exec<{ received_at: number }>("SELECT received_at FROM messages WHERE id = ?", known).toArray()[0]?.received_at
        : undefined);
      const missed = knownTime === undefined ? undefined : messages.find((mail) => mail.id !== known && mail.receivedAt >= knownTime && mail.verification?.status === "detected");
      return { ok: true, revision, messages, data: messages[0]?.id !== known ? read(messages[0]?.id) : null, notification: read(missed?.id), imported };
    };
  }

  nextExpiry(): number | null {
    if (this.retentionMs === 0) return null;
    return this.storage.sql.exec<{ next: number | null }>("SELECT MIN(expires_at) AS next FROM messages").one().next;
  }

  expire() {
    if (this.retentionMs === 0) return;
    const now = Date.now();
    this.storage.transactionSync(() => {
      this.storage.sql.exec("DELETE FROM chunks WHERE message_id IN (SELECT id FROM messages WHERE expires_at <= ?)", now);
      const deleted = this.storage.sql.exec("DELETE FROM messages WHERE expires_at <= ?", now).rowsWritten;
      if (deleted) this.incrementRevision();
    });
  }
}

export type MailboxSnapshot = ReturnType<ReturnType<MailboxStore["snapshots"]>>;
