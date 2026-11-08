import type { Env } from "../config/env";
import { mailRoutes } from "../config/routes";

export function consoleResponse(env: Env): Response {
  const domains = (env.MAIL_DOMAINS || env.MAIL_DOMAIN || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return Response.json(
    {
      ok: true,
      environment: env.APP_ENV ?? "unset",
      domain: domains[0] ?? null,
      domains,
      apiAuthEnabled: Boolean(env.API_AUTH_TOKEN),
      retentionSeconds: Number(env.MAIL_RETENTION_SECONDS ?? "0"),
      generatedAt: Date.now(),
      limits: { routingRulesPerDomain: 200 },
      integrations: {
        telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        webhook: Boolean(env.WEBHOOK_URL),
        storage: Boolean(env.MAILBOXES),
      },
      routes: mailRoutes.map((route) => ({
        match: route.match,
        action: route.action,
        summary: route.summary,
      })),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
