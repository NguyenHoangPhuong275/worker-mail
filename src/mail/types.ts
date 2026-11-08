import type { Env } from "../config/env";

export type InboundMail = {
  message: ForwardableEmailMessage;
  from: string;
  to: string;
  localPart: string;
  baseLocalPart: string;
  tag: string | null;
  domain: string;
};

export type MailHandler = (
  mail: InboundMail,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

export type MailRoute = {
  /** Tên trước dấu @, hoặc "*" cho phần còn lại. `sales` cũng khớp `sales+tag`. */
  match: string;
  action: string;
  summary: string;
  handler: MailHandler;
};
