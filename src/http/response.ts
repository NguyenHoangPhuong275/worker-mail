export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers: result });
}
