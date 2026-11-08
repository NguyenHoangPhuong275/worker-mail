import { mailboxConfig } from "./mailbox-config.js?v=domains-6";
import { generateAddress } from "./address-generator.js?v=domains-6";
import { requestJson } from "./api-client.js?v=domains-6";
import { createInboxView, shortTime } from "./inbox-view.js?v=domains-6";
import { LiveMailbox } from "./live-mailbox.js?v=domains-6";

const $ = (id) => document.getElementById(id);
const storage = {
  get(store, key) { try { return store.getItem(key) || ""; } catch { return ""; } },
  set(store, key, value) { try { store.setItem(key, value); } catch {} },
};
const key = "worker-mail-current-inbox";
const state = {
  domains: [], address: "", messages: [], selected: "", rendered: "",
  connected: false, generation: 0, request: 0, detail: 0,
  polling: 0, loading: false, controller: null, toastTimer: 0,
  realtime: null, live: false, revision: -1, lastSync: 0, liveOtpId: "", notified: new Set(),
};

function status(text, kind = "") {
  $("status-text").textContent = text;
  $("connection-status").className = "connection-status" + (kind ? " is-" + kind : "");
}
function toast(text) {
  $("toast").textContent = text; $("toast").classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => $("toast").classList.remove("is-visible"), 2400);
}
async function copy(value, message) {
  try { await navigator.clipboard.writeText(value); toast(message); }
  catch { toast("Hãy chọn và sao chép thủ công."); }
}
function validAddress(address) {
  const parts = address.toLowerCase().trim().split("@");
  return parts.length === 2 && /^[a-z0-9][a-z0-9.+_-]{0,63}$/i.test(parts[0]) && state.domains.includes(parts[1]);
}
function rememberAddress(address) {
  storage.set(localStorage, key, address); storage.set(sessionStorage, key, address);
  const url = new URL(location.href);
  url.searchParams.delete("preview"); url.searchParams.set("to", address);
  history.replaceState(null, "", url);
}
const view = createInboxView({ onSelect: (id) => openMessage(id, true), onExpire: () => { state.liveOtpId = ""; } });
function clearReader() {
  state.detail += 1; state.selected = ""; state.rendered = ""; state.liveOtpId = "";
  view.clearReader();
}
function empty(title, description) {
  $("empty-title").textContent = title;
  $("empty-description").textContent = description;
  $("empty-state").hidden = false;
}
function showAddress(address, synchronize = true) {
  state.generation += 1; state.request += 1; state.controller?.abort();
  state.realtime?.stop(); state.live = false; state.revision = -1; state.lastSync = 0; state.notified.clear();
  state.loading = false; state.address = address.trim().toLowerCase(); state.messages = [];
  rememberAddress(state.address); clearReader();
  $("current-address").textContent = state.address;
  $("domain-label").textContent = "@" + state.address.split("@")[1];
  $("message-count").textContent = "0"; $("message-list").replaceChildren();
  $("list-view").hidden = false; $("refresh-inbox").disabled = false;
  document.querySelector(".list-columns").hidden = true;
  empty("Đang tải hộp thư…", "Đang kiểm tra email của địa chỉ này.");
  if (state.connected && synchronize) { startLive(); refreshInbox(false, true); }
}
function renderList() { view.renderList(state.messages, state.selected); }
function renderMessage(mail, scroll = false) {
  if (!mail?.id || mail.to?.toLowerCase() !== state.address) return;
  state.selected = mail.id; state.rendered = mail.id;
  view.renderMessage(mail, scroll); renderList();
}
async function openMessage(id, scroll = false, force = false) {
  if (scroll) state.liveOtpId = "";
  if (state.rendered === id && !force) return;
  state.selected = id; renderList();
  const generation = state.generation, request = ++state.detail;
  try {
    const result = await requestJson("/api/mail/message?to=" + encodeURIComponent(state.address) + "&id=" + encodeURIComponent(id));
    if (generation !== state.generation || request !== state.detail) return;
    if (result.response.status === 401) { disconnected(); return; }
    if (!result.response.ok || !result.body.data) throw new Error("unavailable");
    renderMessage(result.body.data, scroll);
  } catch {
    if (generation === state.generation && request === state.detail) toast("Chưa mở được thư. Đang kiểm tra lại hộp thư.");
  }
}
function disconnected() {
  state.connected = false; clearInterval(state.polling);
  state.realtime?.stop(); state.realtime = null; state.live = false;
  status("Chưa kết nối", "error");
  $("connect-button").querySelector("span").textContent = "Kết nối";
  $("inbox-feedback").textContent = "Kết nối hộp thư để đọc email.";
  if (!state.messages.length) empty("Cần kết nối hộp thư", "Nhập mã truy cập ở nút Kết nối phía trên.");
}
function validOtp(mail) {
  const info = mail?.verification;
  return mail?.to?.toLowerCase() === state.address && info?.version === 2 && info.status === "detected" &&
    info.code && info.code === mail.otp && (!info.expiresAt || info.expiresAt > Date.now());
}
function acceptSnapshot(snapshot) {
  const revision = Number.isFinite(snapshot.revision) ? snapshot.revision : 0;
  if (revision < state.revision) return false;
  state.revision = revision; state.lastSync = Date.now();
  const previousLatest = state.messages[0]?.id;
  state.messages = snapshot.messages;
  const latest = state.messages[0];
  renderList();
  const priority = [snapshot.changed, snapshot.notification].find((mail) =>
    validOtp(mail) && !state.notified.has(mail.id) && state.messages.some((row) => row.id === mail.id));
  if (priority) {
    state.notified.add(priority.id);
    if (state.notified.size > 100) state.notified.delete(state.notified.values().next().value);
    state.detail += 1; state.liveOtpId = priority.id;
    renderMessage(priority);
    if (priority.partial) openMessage(priority.id, false, true);
    toast("Đã nhận " + (priority.verification.label || "mã xác thực").toLowerCase());
  } else if (!latest) {
    clearReader(); empty("Hộp thư đang trống", "Email gửi đến địa chỉ trên sẽ tự hiện tại đây.");
  } else {
    const pinned = state.liveOtpId && state.rendered === state.liveOtpId && view.otp && state.messages.some((mail) => mail.id === state.liveOtpId);
    if (!pinned && (!state.rendered || latest.id !== previousLatest || !state.messages.some((mail) => mail.id === state.selected))) {
      state.detail += 1;
      if (snapshot.data?.id === latest.id) {
        renderMessage(snapshot.data);
        if (snapshot.data.partial) openMessage(latest.id, false, true);
      } else openMessage(latest.id);
    }
  }
  return true;
}
function startLive() {
  state.realtime?.stop(); state.live = false;
  if (typeof WebSocket !== "function" || !state.connected) return;
  const generation = state.generation;
  state.realtime = new LiveMailbox({
    address: state.address, known: () => state.messages[0]?.id || "",
    onSnapshot: (snapshot) => {
      if (generation !== state.generation || !state.connected) return;
      if (acceptSnapshot(snapshot)) $("inbox-feedback").textContent = "Nhận trực tiếp · Đồng bộ " + shortTime(Date.now());
    },
    onStatus: (value) => {
      if (generation !== state.generation || !state.connected) return;
      state.live = value === "live";
      status(state.live ? "Nhận trực tiếp" : "Đang nối kênh trực tiếp…", state.live ? "connected" : "");
    },
    onAuthRequired: () => { if (generation === state.generation) restoreConnection(); },
  });
  state.realtime.start();
}
async function refreshInbox(manual = false, force = false) {
  if (!state.connected) { if (manual) $("connect-dialog").showModal(); return; }
  if ((document.hidden && !force && !manual) || (state.loading && !manual)) return;
  if (manual) state.controller?.abort();
  const controller = new AbortController(); state.controller = controller;
  const generation = state.generation, request = ++state.request;
  state.loading = true;
  if (manual) status("Đang kiểm tra thư…");
  try {
    const known = state.rendered ? state.messages[0]?.id || "" : "";
    const result = await requestJson("/api/mail/messages?to=" + encodeURIComponent(state.address) + "&known=" + encodeURIComponent(known), { signal: controller.signal });
    if (generation !== state.generation || request !== state.request) return;
    if (result.response.status === 401) { disconnected(); return; }
    if (!result.response.ok || !result.body.ok || !Array.isArray(result.body.messages)) throw new Error("unavailable");
    if (!acceptSnapshot(result.body)) return;
    status(state.live ? "Nhận trực tiếp" : "Đang nhận thư", "connected");
    $("inbox-feedback").textContent = (state.live ? "Nhận trực tiếp · Đồng bộ " : "Đã kiểm tra ") + shortTime(Date.now());
    if (manual) toast("Đã cập nhật hộp thư.");
  } catch {
    if (generation === state.generation && request === state.request && !state.live) {
      status("Đang kết nối lại…", "error");
      $("inbox-feedback").textContent = "Chưa kiểm tra được thư. Hệ thống đang thử lại.";
      if (!state.messages.length) empty("Đang kết nối lại…", "Chưa xác định được hộp thư có email mới hay không.");
    }
  } finally {
    if (generation === state.generation && request === state.request) state.loading = false;
  }
}
function renderDomains() {
  $("domain-select").replaceChildren(...state.domains.map((domain) => {
    const option = document.createElement("option"); option.value = domain; option.textContent = domain; return option;
  }));
}
async function connect(token = "") {
  if (token) {
    const login = await requestJson("/api/session", { token, method: "POST" });
    if (!login.response.ok) throw new Error("Mã truy cập chưa đúng.");
  }
  const result = await requestJson("/api/console", { token });
  if (!result.response.ok || !result.body.ok) throw new Error("Chưa kết nối được hộp thư.");
  state.domains = [...new Set((Array.isArray(result.body.domains) ? result.body.domains : [])
    .filter((domain) => typeof domain === "string")
    .map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
  renderDomains();
  for (const id of ["new-address", "change-address", "copy-address"]) $(id).disabled = !state.domains.length;
  if (!state.domains.length) throw new Error("Chưa có domain nhận thư trong cấu hình.");
  state.connected = true;
  sessionStorage.removeItem("worker-mail-api-token");
  const retentionLabel = $("retention-label");
  if (retentionLabel) retentionLabel.textContent = result.body.retentionSeconds > 0
    ? `Thư được lưu trong ${result.body.retentionSeconds / 3600} giờ.`
    : "Thư được giữ lại, không tự xóa.";
  if (!validAddress(state.address)) {
    const candidates = [new URL(location.href).searchParams.get("to"), storage.get(sessionStorage, key), storage.get(localStorage, key)];
    showAddress(candidates.find((address) => address && validAddress(address)) || generateAddress(state.domains, state.address), false);
  }
  $("connect-button").querySelector("span").textContent = "Đã kết nối";
  clearInterval(state.polling);
  startLive();
  await refreshInbox(false, true);
  if (state.connected) state.polling = setInterval(() => {
    if (!state.live || Date.now() - state.lastSync >= mailboxConfig.repairInterval) return refreshInbox();
  }, mailboxConfig.fallbackInterval);
}
async function restoreConnection() {
  try {
    const oldToken = storage.get(sessionStorage, "worker-mail-api-token");
    if (oldToken) { await connect(oldToken); return; }
    const session = await requestJson("/api/session");
    if (!session.response.ok || !session.body.connected) { disconnected(); return; }
    await connect();
  } catch {
    status("Kết nối gián đoạn", "error");
    $("inbox-feedback").textContent = "Đang thử kết nối lại…";
    if (!state.messages.length) empty("Đang kết nối lại…", "Vui lòng chờ trong giây lát.");
    setTimeout(() => { if (!state.connected) restoreConnection(); }, 3000);
  }
}
$("copy-address").addEventListener("click", () => copy(state.address, "Đã sao chép địa chỉ."));
$("copy-otp").addEventListener("click", () => { if (view.otp) copy(view.otp, "Đã sao chép mã của thư đang mở."); });
$("new-address").addEventListener("click", () => {
  const address = generateAddress(state.domains, state.address);
  showAddress(address);
  copy(address, "Đã tạo và sao chép địa chỉ mới.");
});
$("refresh-inbox").addEventListener("click", () => refreshInbox(true, true));
$("change-address").addEventListener("click", () => {
  $("localpart-input").value = state.address.split("@")[0]; $("domain-select").value = state.address.split("@")[1];
  $("address-error").hidden = true; $("address-dialog").showModal(); $("localpart-input").select();
});
$("address-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const address = $("localpart-input").value.trim().toLowerCase() + "@" + $("domain-select").value;
  if (!validAddress(address) || address.split("@")[0].split("+")[0] === "drop") {
    $("address-error").textContent = "Nhập tên hợp lệ để nhận thư."; $("address-error").hidden = false; return;
  }
  showAddress(address); $("address-dialog").close();
});
$("connect-button").addEventListener("click", () => {
  $("token-input").value = ""; $("connect-error").hidden = true; $("connect-dialog").showModal();
});
$("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("connect-submit").disabled = true; $("connect-error").hidden = true;
  try { await connect($("token-input").value.trim()); $("connect-dialog").close(); }
  catch (error) { $("connect-error").textContent = error.message; $("connect-error").hidden = false; }
  finally { $("connect-submit").disabled = false; }
});
$("disconnect-button").addEventListener("click", async () => {
  try {
    const result = await requestJson("/api/session", { method: "DELETE" }); if (!result.response.ok) throw new Error();
    state.generation += 1; state.request += 1; state.controller?.abort(); state.messages = [];
    clearReader(); renderList(); disconnected(); $("connect-dialog").close();
  } catch { toast("Chưa ngắt được kết nối. Hãy thử lại."); }
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
function resumeInbox() {
  if (!state.connected) { restoreConnection(); return; }
  state.realtime?.sync(); refreshInbox(false, true);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeInbox(); });
window.addEventListener("online", resumeInbox);
window.addEventListener("pagehide", () => state.realtime?.stop());
window.addEventListener("pageshow", (event) => { if (event.persisted) { startLive(); resumeInbox(); } });
renderDomains();
restoreConnection();
