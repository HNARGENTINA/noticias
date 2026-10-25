export const json = (data: unknown, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
export function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export const clampInt = (v: string | null, def: number, min: number, max: number) => Math.min(Math.max(Number(v) || def, min), max);
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function iso(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d.toISOString();
}
