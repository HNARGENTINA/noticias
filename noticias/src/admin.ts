import { json, safeEq } from "./util.ts";
import { ingestAll } from "./ingest.ts";
import { parseFeed } from "./feed.ts";

const TYPES = ["cert", "agency", "vendor", "publication", "research", "other"];
const REL = ["high", "medium", "low", "unrated"];
const GROUPS = ["all", "rss0", "rss1", "kev", "nvd", "translate"];
const MAX_FAILS = 5;

async function auth(req: Request, env: any): Promise<Response | null> {
  if (!env.ADMIN_TOKEN) return json({ error: "admin_no_configurado" }, 503);
  const key = "rl:" + (req.headers.get("cf-connecting-ip") || "unknown");
  const fails = Number(await env.CACHE?.get(key)) || 0;
  if (fails >= MAX_FAILS) return json({ error: "demasiados_intentos" }, 429);
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!safeEq(tok, env.ADMIN_TOKEN)) {
    await env.CACHE?.put(key, String(fails + 1), { expirationTtl: 600 });
    return json({ error: "no_autorizado" }, 401);
  }
  return null;
}

const badHost = (h: string) => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[");
function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || badHost(u.hostname) || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

function validate(b: any, full: boolean): { v?: Record<string, any>; error?: string } {
  const v: Record<string, any> = {};
  const has = (k: string) => b[k] !== undefined;
  if (full || has("slug")) { if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(b.slug))) return { error: "slug_invalido" }; v.slug = b.slug; }
  if (full || has("name")) { if (typeof b.name !== "string" || b.name.trim().length < 2 || b.name.length > 80) return { error: "nombre_invalido" }; v.name = b.name.trim(); }
  for (const k of ["url", "feed_url"]) if (full || has(k)) { const u = httpsUrl(b[k]); if (!u) return { error: k + "_invalida_solo_https_publico" }; v[k] = u; }
  if (full || has("language")) { if (!/^[a-z]{2}$/.test(String(b.language))) return { error: "idioma_invalido" }; v.language = b.language; }
  if (full || has("source_type")) { if (!TYPES.includes(b.source_type)) return { error: "tipo_invalido" }; v.source_type = b.source_type; }
  if (has("reliability")) { if (!REL.includes(b.reliability)) return { error: "fiabilidad_invalida" }; v.reliability = b.reliability; }
  if (has("poll_interval_min")) { const n = Number(b.poll_interval_min); if (!Number.isInteger(n) || n < 15 || n > 1440) return { error: "intervalo_15_a_1440" }; v.poll_interval_min = n; }
  if (has("enabled")) v.enabled = b.enabled ? 1 : 0;
  return { v };
}

export async function handleAdmin(req: Request, env: any, ctx: { waitUntil(p: Promise<unknown>): void }, url: URL): Promise<Response> {
  const denied = await auth(req, env);
  if (denied) return denied;
  const p = url.pathname, m = req.method;

  if (p === "/api/admin/ingest" && m === "POST") {
    const g = url.searchParams.get("group") || "all";
    if (!GROUPS.includes(g)) return json({ error: "grupo_invalido", validos: GROUPS }, 400);
    ctx.waitUntil(ingestAll(env, true, g as any));
    return json({ ok: true, group: g, mensaje: "Ingesta forzada iniciada. Revisá /api/status en unos instantes. En el plan gratuito conviene ejecutar un grupo por vez." }, 202);
  }

  if (p === "/api/admin/sources" && m === "GET") {
    const rows = (await env.DB.prepare("SELECT id, slug, name, url, feed_url, language, source_type, reliability, adapter, poll_interval_min, enabled, verified_at, last_success_at, last_error, consecutive_failures FROM sources ORDER BY id").all()).results;
    return json({ items: rows });
  }

  if (p === "/api/admin/sources" && m === "POST") {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "json_invalido" }, 400);
    const { v, error } = validate({ reliability: "unrated", poll_interval_min: 60, ...(body as any) }, true);
    if (error) return json({ error }, 400);
    try {
      const row = await env.DB.prepare("INSERT INTO sources(slug,name,url,feed_url,language,source_type,reliability,poll_interval_min,adapter,enabled) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'rss',0) RETURNING id")
        .bind(v!.slug, v!.name, v!.url, v!.feed_url, v!.language, v!.source_type, v!.reliability, v!.poll_interval_min).first();
      return json({ ok: true, id: row.id, mensaje: "Creada deshabilitada. Probala con POST /api/admin/sources/" + row.id + "/test y luego activala." }, 201);
    } catch { return json({ error: "slug_duplicado" }, 409); }
  }

  const sm = p.match(/^\/api\/admin\/sources\/(\d+)(\/test)?$/);
  if (sm) {
    const id = Number(sm[1]);
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = ?1").bind(id).first();
    if (!src) return json({ error: "no_encontrada" }, 404);

    if (sm[2] && m === "POST") {
      if (src.adapter !== "rss") return json({ error: "solo_fuentes_rss" }, 400);
      try {
        const r = await fetch(src.feed_url, { headers: { "user-agent": "HackerNewsArBot/0.3 (+https://hackernews.com.ar)" } });
        const items = parseFeed((await r.text()).slice(0, 2_000_000));
        const ok = r.ok && items.length > 0;
        if (ok) await env.DB.prepare("UPDATE sources SET verified_at = datetime('now') WHERE id = ?1").bind(id).run();
        return json({ ok, http_status: r.status, content_type: r.headers.get("content-type"), entries: items.length, sample: items.slice(0, 3).map((i) => ({ title: i.title, url: i.url, published_at: i.publishedAt })),
          mensaje: ok ? "Feed válido. Ya podés activarla." : "No se pudo leer un feed válido." });
      } catch (e: any) { return json({ ok: false, mensaje: String(e?.message || e).slice(0, 200) }); }
    }

    if (!sm[2] && m === "PATCH") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ error: "json_invalido" }, 400);
      const { v, error } = validate(body, false);
      if (error) return json({ error }, 400);
      if (v!.slug) return json({ error: "slug_inmutable" }, 400);
      if (v!.enabled === 1 && !src.enabled && !src.verified_at && !v!.feed_url) return json({ error: "fuente_no_verificada", mensaje: "Probá la fuente con /test antes de activarla." }, 409);
      if (v!.feed_url && v!.feed_url !== src.feed_url) { v!.verified_at = null; v!.etag = null; v!.last_modified = null; if (v!.enabled === 1) return json({ error: "fuente_no_verificada", mensaje: "Cambiaste la URL del feed: probala antes de activarla." }, 409); v!.enabled = 0; }
      const keys = Object.keys(v!);
      if (!keys.length) return json({ error: "sin_cambios" }, 400);
      await env.DB.prepare(`UPDATE sources SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(", ")} WHERE id = ?${keys.length + 1}`).bind(...keys.map((k) => v![k]), id).run();
      return json({ ok: true });
    }
  }
  return json({ error: "no_encontrado" }, 404);
}
