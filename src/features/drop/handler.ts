import type { MailHandler } from "../../mail/types";

export const drop: MailHandler = async (mail) => {
  console.log(
    JSON.stringify({
      action: "drop",
      from: mail.from,
      to: mail.to,
    }),
  );
};
