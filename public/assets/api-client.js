export async function requestJson(path, { token = "", method = "GET", signal, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(path, { method, signal: controller.signal, credentials: "same-origin", headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
    const body = await response.json();
    return { response, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
