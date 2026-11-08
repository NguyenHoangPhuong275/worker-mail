import { renderMailContent, renderAttachments } from "./mail-renderer.js?v=domains-6";

export const shortTime = (value) => new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Owns DOM rendering, OTP expiry and attachment URL cleanup. */
export function createInboxView({ onSelect, onExpire }) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, document.getElementById(id));
    return elements.get(id);
  };
  let listKey = "", otp = "", otpTimer = 0, rendered = "", releaseAttachments = () => {};
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    svg.setAttribute("aria-hidden", "true"); use.setAttribute("href", "#i-" + name); svg.append(use); return svg;
  }
  function renderList(messages, selected) {
    element("message-count").textContent = String(messages.length);
    element("empty-state").hidden = messages.length > 0;
    // One received email is displayed directly; multiple emails get a compact selector.
    const showSelector = messages.length > 1;
    element("message-list").hidden = !showSelector;
    document.querySelector(".list-columns").hidden = !showSelector;
    const signature = JSON.stringify(messages.map((mail) => [mail.id, mail.subject, mail.from, mail.receivedAt]));
    if (signature !== listKey) {
      listKey = signature;
      const list = element("message-list"); list.replaceChildren();
      for (const mail of messages) {
        const button = document.createElement("button"); button.type = "button"; button.className = "message-row"; button.dataset.id = mail.id;
        button.setAttribute("aria-label", "Đọc thư: " + (mail.subject || "Không có tiêu đề"));
        const sender = document.createElement("span"); sender.className = "message-sender";
        const name = document.createElement("strong"); name.textContent = (mail.from || "Không rõ người gửi").split("<")[0].trim();
        sender.append(name);
        const subject = document.createElement("span"); subject.className = "message-summary";
        const title = document.createElement("strong"); title.textContent = mail.subject || "(Không có tiêu đề)"; subject.append(title);
        const time = document.createElement("time"); time.textContent = shortTime(mail.receivedAt); time.dateTime = new Date(mail.receivedAt).toISOString();
        button.append(sender, subject, time, icon("arrow"));
        button.addEventListener("click", () => onSelect(mail.id));
        const item = document.createElement("li"); item.append(button); list.append(item);
      }
    }
    for (const row of element("message-list").querySelectorAll("button")) row.setAttribute("aria-pressed", String(row.dataset.id === selected));
  }
  function renderVerification(mail) {
    clearTimeout(otpTimer);
    otp = "";
    const info = mail.verification;
    const expired = info?.status === "expired" || (info?.expiresAt && info.expiresAt <= Date.now());
    const detected = info?.version === 2 && info.status === "detected" && info.code && info.code === mail.otp && !expired;
    element("otp-box").hidden = !detected; element("copy-otp").disabled = !detected;
    element("otp-notice").hidden = true;
    element("otp-value").textContent = "";
    if (info?.status === "ambiguous" || expired) {
      element("otp-notice").hidden = false;
      element("otp-notice").textContent = expired ? "Mã trong thư này đã hết hạn theo thời gian ghi trong email." : "Thư có nhiều mã xác thực khác nhau. Hãy kiểm tra nội dung bên dưới.";
    }
    if (!detected) return;
    otp = info.code;
    element("otp-label").textContent = info.label || "Mã xác thực (OTP)";
    element("otp-value").textContent = info.code;
    element("otp-context").textContent = "Nhận lúc " + shortTime(mail.receivedAt) + (info.expiresAt ? " · Hết hạn lúc " + shortTime(info.expiresAt) : "");
    if (info.expiresAt) otpTimer = setTimeout(() => {
      if (rendered !== mail.id) return;
      otp = ""; onExpire(); element("otp-box").hidden = true; element("copy-otp").disabled = true;
      element("otp-notice").textContent = "Mã trong thư này đã hết hạn theo thời gian ghi trong email.";
      element("otp-notice").hidden = false;
    }, Math.max(0, info.expiresAt - Date.now()));
  }
  function renderMessage(mail, scroll = false) {
    rendered = mail.id;
    element("reader-subject").textContent = mail.subject || "(Không có tiêu đề)";
    element("reader-from").textContent = mail.from || "Không rõ người gửi";
    element("reader-to").textContent = "Đến: " + mail.to;
    element("reader-time").textContent = new Date(mail.receivedAt).toLocaleString("vi-VN");
    element("sender-avatar").textContent = (mail.from || "?").slice(0, 1).toUpperCase();
    renderVerification(mail);
    renderMailContent(element("reader-body"), mail);
    releaseAttachments(); releaseAttachments = renderAttachments(element("reader-attachments"), mail.attachments);
    const links = element("reader-links"); links.replaceChildren();
    if (!mail.html) for (const raw of mail.links || []) {
      try {
        const url = new URL(raw); if (!["https:", "http:"].includes(url.protocol)) continue;
        const anchor = document.createElement("a"); anchor.href = url.href; anchor.textContent = url.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
        const item = document.createElement("li"); item.append(anchor); links.append(item);
      } catch {}
    }
    element("activation-links").hidden = !links.children.length;
    element("empty-state").hidden = true; element("list-view").hidden = false; element("reader-view").hidden = false;
    if (scroll) element("reader-view").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function clearReader() {
    clearTimeout(otpTimer);
    rendered = ""; otp = ""; listKey = "";
    element("otp-box").hidden = true; element("otp-notice").hidden = true; element("copy-otp").disabled = true;
    releaseAttachments(); releaseAttachments = () => {};
    element("reader-view").hidden = true; element("reader-body").replaceChildren();
    element("reader-attachments").replaceChildren();
  }
  return { renderList, renderMessage, clearReader, get otp() { return otp; } };
}
