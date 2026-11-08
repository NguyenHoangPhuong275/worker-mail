import type { Verification } from "./otp";

export type StoredMail = {
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  otp: string | null;
  links: string[];
  receivedAt: number;
  sentAt?: number;
  verification?: Verification;
  attachments?: { filename: string; mimeType: string; contentId: string | null; content: string }[];
};

export type InboxMessage = Pick<StoredMail, "id" | "from" | "subject" | "otp" | "receivedAt" | "verification"> & {
  preview: string;
};

export function inboxIndexPrefix(address: string): string {
  return `mail:inbox:${address.toLowerCase()}:`;
}

export function summarizeMail(mail: StoredMail & { verification: Verification }): InboxMessage {
  return {
    id: mail.id,
    from: truncateUtf8(mail.from, 180),
    subject: truncateUtf8(mail.subject, 180),
    otp: mail.otp,
    verification: mail.verification,
    receivedAt: mail.receivedAt,
    preview: truncateUtf8((mail.text || "").replace(/\s+/g, " ").trim(), 240),
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let size = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const characterSize = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (size + characterSize > maxBytes) return result + "…";
    result += character;
    size += characterSize;
  }
  return result;
}
