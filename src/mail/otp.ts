export type Verification = {
  version: 2;
  status: "none" | "detected" | "ambiguous" | "expired";
  code: string | null;
  purpose: "login" | "email" | "password_reset" | "verification" | null;
  label: string | null;
  expiresAt: number | null;
};

const SECURITY = /\b(?:otp|verification\s+(?:code|number|token)|confirmation\s+code|security\s+code|authentication\s+(?:code|token)|authenticator\s+code|password\s+reset\s+code|reset\s+code|login\s+code|sign[\s-]?in\s+code|(?:one[\s-]?time|single[\s-]?use)\s+(?:code|password|passcode)|passcode|2fa\s+code|two[\s-]?factor\s+code)\b|mã\s+(?:xác\s+(?:nhận|thực|minh)|đăng\s*nhập|bảo\s*mật|một\s*lần|otp)/gi;
const GENERIC = /\b(?:your\s+code|code(?:\s+is)?|pin)\b|mã(?:\s+của\s+bạn)?/gi;
const COMMERCIAL = /\b(?:promo(?:tional)?|discount|coupon|redeem|voucher|order|invoice|tracking|receipt|reference|generation|customer\s*id|request\s*id|license|serial)\b|khuyến\s*mãi|giảm\s*giá|đơn\s*hàng|hóa\s*đơn|mã\s*đơn/gi;
const AUTH_SUBJECT = /\b(?:sign[\s-]?in|log[\s-]?in|verification|verify\s+(?:your\s+)?email|confirm\s+(?:your\s+)?email|reset.*password|password.*reset|authenticate)\b|đăng\s*nhập|xác\s*(?:nhận|thực)|đặt\s*lại\s*mật\s*khẩu/i;
const TOKEN = /\b(?:[0-9]{3}[ -][0-9]{3}|[0-9]{2}(?:[ -][0-9]{2}){2}|[0-9]{4,8}|[A-Z0-9]{6,10})\b/g;

function plainContent(text: string, html: string): string {
  const source = text.trim() ? text : html
    .replace(/<(script|style|blockquote)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Math.min(parseInt(value, 16), 0x10ffff)))
    .replace(/&#([0-9]+);/g, (_, value) => String.fromCodePoint(Math.min(Number(value), 0x10ffff)))
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, (value) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[value.toLowerCase()] || " "));
  return source.split(/(?:^|\n)(?:On .{0,200} wrote:|Vào .{0,200} đã viết:|[- ]{2,}Original Message[- ]{2,})/i)[0]
    .replace(/https?:\/\/[^\s<>]+/gi, " ")
    .split("\n").filter((line) => !/^\s*>/.test(line)).join("\n");
}

type Label = { start: number; end: number };
function labels(source: string, pattern: RegExp): Label[] {
  return Array.from(source.matchAll(pattern), (match) => ({ start: match.index!, end: match.index! + match[0].length }));
}

function nearestLabel(source: string, start: number, end: number, positions: Label[], security = false): number {
  let nearest = Infinity;
  let low = 0, high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (positions[middle].end < start - 55) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < positions.length; index++) {
    const { start: labelStart, end: labelEnd } = positions[index];
    if (labelStart > end + 40) break;
    if (labelEnd <= start) {
      const gap = source.slice(labelEnd, start);
      const alternatives = security && /[0-9]\s*(?:,|\/|\bor\b|\band\b|hoặc|và)\s*$/i.test(gap);
      if (gap.length <= 55 && !/[.!?;]/.test(gap) && (!/[0-9]/.test(gap) || alternatives)) nearest = Math.min(nearest, gap.length);
    } else if (labelStart >= end) {
      const gap = source.slice(end, labelStart);
      if (gap.length <= 40 && !/[0-9.!?;]/.test(gap) && (!security || /(?:is\s+your|is\s+the|là\s+mã|your)/i.test(gap))) nearest = Math.min(nearest, gap.length);
    }
  }
  return nearest;
}

export function analyzeVerification(subject: string, text: string, html = "", timestamp = Date.now(), now = Date.now()): Verification {
  const none: Verification = { version: 2, status: "none", code: null, purpose: null, label: null, expiresAt: null };
  const body = plainContent(text, html);
  const source = subject + "\n" + body;
  const securityLabels = labels(source, SECURITY);
  const genericLabels = AUTH_SUBJECT.test(subject) && !new RegExp(COMMERCIAL.source, "i").test(subject) ? labels(source, GENERIC) : [];
  if (!securityLabels.length && !genericLabels.length) return none;
  const commercialLabels = labels(source, COMMERCIAL);
  const codes = new Set<string>();
  const contexts: string[] = [];
  for (const match of source.matchAll(TOKEN)) {
    const raw = match[0], code = raw.replace(/[ -]/g, ""), start = match.index!, end = start + raw.length;
    if (!/[0-9]/.test(code) || (/[a-z]/i.test(code) && (!/[A-Z]/.test(code) || code.length < 6))) continue;
    if (/^[0-9]+$/.test(code) && code.length > 8) continue;
    if (/[A-Za-z0-9_/$€₫-]/.test(source[start - 1] || "") || /^[0-9_%+]|^[-.,][0-9]/.test(source.slice(end))) continue;
    const previous = source.slice(Math.max(0, start - 70), start);
    const following = source.slice(end, end + 55);
    if (/(?:previous|old|expired|do not use|mã cũ|đã hết hạn|hết hiệu lực)[^\n.!?]{0,35}$/i.test(previous) ||
        /^[^.\n]{0,25}(?:has expired|is expired|đã hết hạn|hết hiệu lực)/i.test(following)) continue;
    let distance = nearestLabel(source, start, end, securityLabels, true);
    if (!Number.isFinite(distance)) distance = nearestLabel(source, start, end, genericLabels, true);
    const commercialDistance = nearestLabel(source, start, end, commercialLabels);
    if (!Number.isFinite(distance) || commercialDistance <= distance) continue;
    codes.add(code);
    contexts.push(previous + raw + following);
  }
  if (!codes.size) return none;
  if (codes.size !== 1) return { ...none, status: "ambiguous" };
  const classifyPurpose = (context: string): Verification["purpose"] =>
    /reset.{0,30}password|password.{0,30}reset|đặt\s*lại\s*mật\s*khẩu|khôi\s*phục\s*mật\s*khẩu/i.test(context) ? "password_reset"
    : /verify.{0,25}email|email.{0,25}verif|confirm.{0,25}email|xác\s*(?:nhận|thực)\s*(?:địa\s*chỉ\s*)?email/i.test(context) ? "email"
    : /sign[\s-]?in|log[\s-]?in|đăng\s*nhập/i.test(context) ? "login" : null;
  const context = contexts.join("\n");
  const purpose = classifyPurpose(subject) || classifyPurpose(context) || "verification";
  const label = { password_reset: "Mã đặt lại mật khẩu", email: "Mã xác minh email", login: "Mã đăng nhập", verification: "Mã xác thực (OTP)" }[purpose];
  const duration = context.match(/(?:expires?(?:\s+in)?|valid\s+for|active\s+for)[^\d\n]{0,20}(\d{1,3})\s*(minutes?|mins?|seconds?|secs?)\b/i)
    || context.match(/(?:hiệu\s*lực|hết\s*hạn|có\s*giá\s*trị)[^\d\n]{0,30}(\d{1,3})\s*(phút|giây)/i);
  const expiresAt = duration ? timestamp + Number(duration[1]) * (/^(?:min|phút)/i.test(duration[2]) ? 60000 : 1000) : null;
  if (expiresAt !== null && expiresAt <= now) return { ...none, status: "expired", purpose, label, expiresAt };
  return { version: 2, status: "detected", code: [...codes][0], purpose, label, expiresAt };
}

export function extractVerificationCode(subject: string, content: string): string | null {
  return analyzeVerification(subject, content).code;
}

export function normalizeVerification<T extends { subject: string; text: string; html: string; receivedAt: number; sentAt?: number; otp: string | null }>(mail: T, now = Date.now()): T & { verification: Verification } {
  const timestamp = mail.sentAt && mail.sentAt <= mail.receivedAt + 300000 ? mail.sentAt : mail.receivedAt;
  const verification = analyzeVerification(mail.subject, mail.text || "", mail.html || "", timestamp, now);
  return { ...mail, otp: verification.code, verification };
}
