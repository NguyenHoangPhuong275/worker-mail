import type { Env } from "./config/env";
import { handleHttpRequest } from "./http/router";
import { handleEmail } from "./mail/pipeline";
export { Mailbox } from "./mail/mailbox";

export default {
  async email(message, env, ctx) {
    await handleEmail(message, env, ctx);
  },

  async fetch(request, env) {
    return handleHttpRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
