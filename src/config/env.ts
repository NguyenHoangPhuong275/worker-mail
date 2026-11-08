export interface Env {
  APP_ENV?: string;
  MAIL_DOMAIN?: string;
  MAIL_DOMAINS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  WEBHOOK_URL?: string;
  API_AUTH_TOKEN?: string;
  MAIL_API_BASE_URL?: string;
  MAIL_RETENTION_SECONDS?: string;
  MAIL_KV?: KVNamespace;
  MAILBOXES?: DurableObjectNamespace;
}
