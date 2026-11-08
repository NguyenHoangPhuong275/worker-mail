/** Reconnectable, cookie-authenticated mailbox push. REST remains the repair path. */
export class LiveMailbox {
  constructor({ address, known, onSnapshot, onStatus, onAuthRequired, socketFactory = (url) => new WebSocket(url) }) {
    Object.assign(this, { address, known, onSnapshot, onStatus, onAuthRequired, socketFactory });
    this.stopped = true; this.socket = null; this.attempt = 0;
  }
  start() { this.stopped = false; this.connect(); }
  clearTimers() {
    clearTimeout(this.retry); clearTimeout(this.openTimeout); clearTimeout(this.renew); clearTimeout(this.pongTimeout); clearInterval(this.heartbeat);
  }
  stop() {
    this.stopped = true; this.clearTimers();
    this.closeSocket("Mailbox closed");
  }
  closeSocket(reason) {
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; try { socket.close(1000, reason); } catch {} }
  }
  reconnect() {
    if (this.stopped) return;
    this.clearTimers();
    this.closeSocket("Reconnecting");
    this.onStatus("reconnecting");
    this.retry = setTimeout(() => this.connect(), Math.min(250 * 2 ** Math.min(this.attempt++, 5), 5000));
  }
  connect() {
    if (this.stopped) return;
    this.clearTimers(); this.onStatus("connecting");
    const url = new URL("/api/mail/live", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("to", this.address);
    if (this.known()) url.searchParams.set("known", this.known());
    let socket;
    try { socket = this.socketFactory(url.href); } catch { this.reconnect(); return; }
    this.socket = socket;
    this.openTimeout = setTimeout(() => this.reconnect(), 7000);
    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      clearTimeout(this.openTimeout); this.attempt = 0;
      this.heartbeat = setInterval(() => {
        if (socket.readyState !== 1) { this.reconnect(); return; }
        try { socket.send("ping"); } catch { this.reconnect(); return; }
        clearTimeout(this.pongTimeout);
        this.pongTimeout = setTimeout(() => this.reconnect(), 8000);
      }, 15000);
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || this.stopped) return;
      if (event.data === "pong") { clearTimeout(this.pongTimeout); return; }
      try {
        if (typeof event.data !== "string" || event.data.length > 1_000_000) throw new Error("Invalid packet");
        const packet = JSON.parse(event.data);
        if (packet.type !== "mailbox" || !packet.ok || !Array.isArray(packet.messages)) throw new Error("Invalid packet");
        this.onSnapshot(packet);
        if (socket !== this.socket || this.stopped) return;
        this.onStatus("live");
        const id = packet.messages[0]?.id;
        if (id && socket.readyState === 1) socket.send(JSON.stringify({ type: "ack", id }));
        clearTimeout(this.renew);
        if (packet.expiresAt) this.renew = setTimeout(() => this.reconnect(), Math.max(1000, packet.expiresAt - Date.now() - 5000));
      } catch { this.reconnect(); }
    };
    socket.onerror = () => { if (socket === this.socket) this.reconnect(); };
    socket.onclose = (event) => {
      if (socket !== this.socket || this.stopped) return;
      this.reconnect();
      if (event.code === 1008) this.onAuthRequired?.();
    };
  }
  sync() {
    if (this.socket?.readyState === 1) {
      try { this.socket.send(JSON.stringify({ type: "sync" })); return; } catch {}
    }
    if (!this.stopped) this.reconnect();
  }
}
