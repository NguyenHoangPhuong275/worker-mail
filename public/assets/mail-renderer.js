import DOMPurify from "./vendor/purify.es.mjs";

export function renderMailContent(root, mail) {
  root.replaceChildren();
  root.classList.toggle("has-html", Boolean(mail.html));
  if (!mail.html) {
    root.textContent = mail.text || "Thư này không có nội dung văn bản.";
    return;
  }
  const clean = DOMPurify.sanitize(mail.html, {
    USE_PROFILES: { html: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "meta", "base", "link", "video", "audio", "source"],
    FORBID_ATTR: ["srcset", "autofocus", "ping"],
  });
  for (const image of clean.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    const cid = src.startsWith("cid:") ? src.slice(4).replace(/^<|>$/g, "") : "";
    const inline = cid && mail.attachments?.find((file) => file.contentId?.replace(/^<|>$/g, "") === cid);
    if (inline && inline.mimeType.startsWith("image/")) image.setAttribute("src", "data:" + inline.mimeType + ";base64," + inline.content);
    else if (!/^data:image\//i.test(src)) image.removeAttribute("src");
  }
  for (const link of clean.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    if (!/^(https?:|mailto:)/i.test(href)) link.removeAttribute("href");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  const content = document.createElement("div"); content.append(clean);
  const frame = document.createElement("iframe");
  frame.title = "Nội dung email";
  frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.className = "email-html";
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>:root{color-scheme:light}body{margin:0;padding:20px;font:14px/1.65 Arial,sans-serif;color:#24312a;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#167347}pre{white-space:pre-wrap}</style></head><body>' + content.innerHTML + '</body></html>';
  root.append(frame);
}

export function renderAttachments(root, attachments = []) {
  root.replaceChildren();
  const urls = [];
  for (const file of attachments.filter((item) => !item.contentId)) {
    const bytes = Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    urls.push(url);
    const link = document.createElement("a");
    link.href = url; link.download = file.filename || "attachment"; link.textContent = file.filename || "Tệp đính kèm";
    root.append(link);
  }
  root.hidden = !root.children.length;
  return () => urls.forEach((url) => URL.revokeObjectURL(url));
}
