import type { InboundMail } from "./types";

const addressPattern = /^[^\s@]+@[^\s@]+$/;

export function readInboundMail(message: ForwardableEmailMessage): InboundMail {
  const to = extractAddress(message.to);
  const from = message.from.trim() ? extractAddress(message.from) : "";
  const at = to.lastIndexOf("@");
  const localPart = to.slice(0, at);
  const plus = localPart.indexOf("+");

  return {
    message,
    from,
    to,
    localPart,
    baseLocalPart: plus === -1 ? localPart : localPart.slice(0, plus),
    tag: plus === -1 ? null : localPart.slice(plus + 1) || null,
    domain: to.slice(at + 1),
  };
}

function extractAddress(value: string): string {
  const trimmed = value.trim();
  const wrapped = trimmed.match(/<([^<>]+)>\s*$/);
  const address = (wrapped?.[1] ?? trimmed).trim().toLowerCase();

  if (!addressPattern.test(address)) {
    throw new Error(`Invalid email address: ${value}`);
  }

  return address;
}
