import PostalMime from "postal-mime";
import type { MailHandler } from "../../mail/types";
import { saveMail } from "../../mail/repository";
import { normalizeVerification } from "../../mail/otp";

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const ACTIVATION_KEYWORDS = ["verify", "activate", "confirm", "token", "auth", "register", "complete"];

export const telegramOtpHandler: MailHandler = async (mail, env, ctx) => {
  const rawBuffer = await new Response(mail.message.raw).arrayBuffer();
  const parser = new PostalMime();
  const parsed = await parser.parse(rawBuffer);

  const subject = parsed.subject || "(No Subject)";
  const textContent = parsed.text || "";
  const htmlContent = parsed.html || "";
  const combinedContent = `${textContent}\n${htmlContent}`;


  // 2. Trích xuất link xác nhận / kích hoạt
  const allUrls = combinedContent.match(URL_PATTERN) || [];
  const uniqueUrls = Array.from(new Set(allUrls));
  const activationLinks = uniqueUrls
    .filter((url) => ACTIVATION_KEYWORDS.some((kw) => url.toLowerCase().includes(kw)))
    .slice(0, 3);

  const receivedAt = Date.now();
  const payload = normalizeVerification({
    id: crypto.randomUUID(),
    from: parsed.from?.address ? (parsed.from.name ? parsed.from.name + " <" + parsed.from.address + ">" : parsed.from.address) : mail.from,
    to: mail.to,
    localPart: mail.localPart,
    tag: mail.tag,
    subject,
    text: textContent,
    html: htmlContent,
    otp: null,
    links: activationLinks,
    receivedAt,
    sentAt: parsed.date && Number.isFinite(Date.parse(parsed.date)) ? Date.parse(parsed.date) : receivedAt,
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename || "attachment",
      mimeType: attachment.mimeType,
      contentId: attachment.contentId || null,
      content: arrayBufferBase64(attachment.content as ArrayBuffer),
    })),
  });

  // Complete the authoritative write before accepting the incoming email.
  await saveMail(env, payload);

  // 4. Bắn Webhook nếu có cấu hình
  if (env.WEBHOOK_URL) {
    ctx.waitUntil(
      fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => console.error("Webhook error:", err))
    );
  }

  // 5. Gửi thông báo về Telegram Bot
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const escape = (str: string) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const text =
      `📬 <b>NEW EMAIL RECEIVED</b>\n\n` +
      `<b>To:</b> <code>${escape(mail.to)}</code>\n` +
      `<b>From:</b> <code>${escape(mail.from)}</code>\n` +
      `<b>Subject:</b> ${escape(subject)}\n\n` +
      `🔑 <b>OTP:</b> <code>${payload.otp || "Not detected"}</code>\n` +
      (activationLinks.length > 0
        ? `\n🔗 <b>Links:</b>\n${activationLinks.map((l) => `• <a href="${l}">Open Link</a>`).join("\n")}`
        : "");

    const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    ctx.waitUntil(
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }).catch((err) => console.error("Telegram error:", err))
    );
  }
};

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
