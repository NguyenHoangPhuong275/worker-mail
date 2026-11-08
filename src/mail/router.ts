import { mailRoutes } from "../config/routes";
import type { InboundMail, MailRoute } from "./types";

export function findRoute(mail: InboundMail): MailRoute | undefined {
  const specific = mailRoutes.find(
    (route) => route.match !== "*" && matches(route, mail),
  );

  return specific ?? mailRoutes.find((route) => route.match === "*");
}

function matches(route: MailRoute, mail: InboundMail): boolean {
  const name = route.match.toLowerCase();
  return name === mail.localPart || name === mail.baseLocalPart;
}
