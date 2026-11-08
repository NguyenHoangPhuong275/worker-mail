import type { Env } from "../config/env";
import { readInboundMail } from "./address";
import { findRoute } from "./router";

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  let mail;

  try {
    mail = readInboundMail(message);
  } catch (error) {
    console.error(error);
    message.setReject("Invalid recipient");
    return;
  }

  const route = findRoute(mail);

  if (!route) {
    message.setReject("No route for recipient");
    return;
  }

  await route.handler(mail, env, ctx);
}
