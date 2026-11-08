const stems = ["lumi", "nova", "sora", "mira", "nori", "kira", "tavi", "yuna", "milo", "ravi", "nami", "luma", "sumi", "vani", "tori", "zena"];
const endings = ["ka", "li", "ra", "mi", "na", "vo", "ki", "la", "no", "ya", "ri", "mo", "sa", "vi", "ta", "nu"];

export function generateAddress(domains, previous = "") {
  const configured = [...new Set(domains)];
  if (!configured.length) throw new Error("Chưa có domain nhận thư trong cấu hình.");
  const previousDomain = previous.split("@")[1];
  const available = configured.length > 1 ? configured.filter((domain) => domain !== previousDomain) : configured;
  let address;
  do {
    const random = crypto.getRandomValues(new Uint32Array(4));
    const domain = available[random[0] % available.length];
    const name = stems[random[1] % stems.length] + endings[random[2] % endings.length];
    address = name + String(100000 + random[3] % 900000) + "@" + domain;
  } while (address === previous);
  return address;
}
