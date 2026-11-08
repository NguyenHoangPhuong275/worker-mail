import type { StoredMail } from "./storage";

/** Ship the verified code immediately, without waiting for a large HTML/attachment body. */
export function liveMail(mail: StoredMail | null) {
  if (!mail) return null;
  if (mail.text.length + mail.html.length < 24000 && !mail.attachments?.length) return mail;
  return {
    id: mail.id, to: mail.to, from: mail.from, subject: mail.subject, receivedAt: mail.receivedAt,
    otp: mail.otp, verification: mail.verification, sentAt: mail.sentAt,
    text: "Đang tải nội dung thư…", html: "", attachments: [], links: [], partial: true,
  };
}
