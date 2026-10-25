export function findCves(t: string): string[] {
  return [...new Set((t.match(/CVE-\d{4}-\d{4,7}/gi) || []).map((x) => x.toUpperCase()))];
}
export function normTitle(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
const CATS: [string, RegExp][] = [
  ["Ransomware y cibercrimen", /ransomware|extortion|lockbit|cybercrim/i],
  ["Explotación y zero-days", /zero-day|0-day|actively exploited|exploited in the wild|known exploited/i],
  ["Vulnerabilidades y CVE", /CVE-\d{4}-\d{4,}|vulnerab|\bflaw\b|\bpatch/i],
  ["APT y ciberespionaje", /\bapt\d*\b|nation-state|state-sponsored|espionage/i],
  ["Malware y botnets", /malware|botnet|trojan|backdoor|stealer|loader/i],
  ["Filtraciones e incidentes", /data breach|\bbreach|\bleak|hacked/i],
  ["Nube e infraestructura", /\bcloud\b|\baws\b|azure|kubernetes/i],
  ["Seguridad en IA", /\bai\b|\bllm\b|artificial intelligence/i],
  ["OT/ICS", /\bics\b|scada|industrial control/i],
  ["Seguridad móvil", /android|\bios\b|mobile/i],
];
export function classify(t: string): string[] {
  const out = CATS.filter(([, re]) => re.test(t)).map(([c]) => c);
  return out.length ? out.slice(0, 3) : ["Seguridad general"];
}
export type Actor = { attack_id: string; name: string; aliases: string | null };
export function actorNames(a: Actor): string[] {
  const names = new Set<string>();
  const add = (n: string) => { n = n.trim(); if (n.length >= 5) names.add(n); };
  add(a.name);
  add(a.name.replace(/\s+(Team|Group)$/i, ""));
  try { for (const x of JSON.parse(a.aliases || "[]")) add(String(x)); } catch { /* alias invalidos: se ignoran */ }
  return [...names];
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function findActors(text: string, actors: Actor[]): string[] {
  return actors
    .filter((a) => actorNames(a).some((n) => new RegExp(`(^|[^A-Za-z0-9])${esc(n)}([^A-Za-z0-9]|$)`, "i").test(text)))
    .map((a) => a.attack_id);
}
