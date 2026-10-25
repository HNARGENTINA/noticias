import { json, clampInt } from "./util.ts";
import { handleAdmin } from "./admin.ts";
import { articlePage, articleUrl, notFoundPage, robotsTxt, sitemapXml, HTML_HEADERS } from "./pages.ts";

function nextRun(now = new Date()) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  const mins = [0, 5, 10, 15, 20, 30, 35, 40, 45];
  const next = mins.find((m) => m > d.getUTCMinutes());
  if (next === undefined) { d.setUTCHours(d.getUTCHours() + 1); d.setUTCMinutes(0); } else d.setUTCMinutes(next);
  return d.toISOString();
}
const withPath = (r: any) => ({ ...r, path: articleUrl(r) });

export async function handle(req: Request, env: any, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname, q = url.searchParams;
  const origin = env.SITE_URL || url.origin;

  if (p === "/robots.txt") return new Response(robotsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (p === "/sitemap.xml") {
    const rows = (await env.DB.prepare("SELECT id, title_es, original_title, updated_at, ingested_at FROM articles WHERE status = 'published' AND translation_status IN ('done','skipped') ORDER BY id DESC LIMIT 1000").all()).results;
    return new Response(sitemapXml(origin, rows), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=1800" } });
  }

  const page = p.match(/^\/noticias\/(\d+)(?:-[^/]*)?\/?$/);
  if (page) {
    const a = await env.DB.prepare("SELECT a.*, s.name AS source_name, s.url AS source_url FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ?1 AND a.status != 'rejected'").bind(Number(page[1])).first();
    if (!a) return new Response(notFoundPage(), { status: 404, headers: { ...HTML_HEADERS, "cache-control": "no-store" } });
    const want = articleUrl(a);
    if (p !== want) return Response.redirect(origin + want, 301);
    const cats = (await env.DB.prepare("SELECT category FROM article_categories WHERE article_id = ?1").bind(a.id).all()).results.map((r: any) => r.category);
    const ents = (await env.DB.prepare("SELECT e.entity_type, e.entity_id, ac.name AS actor_name, ac.url AS actor_url FROM article_entities e LEFT JOIN actors ac ON e.entity_type = 'actor' AND ac.attack_id = e.entity_id WHERE e.article_id = ?1").bind(a.id).all()).results;
    const related = cats[0] ? (await env.DB.prepare("SELECT a.id, a.title_es, a.original_title FROM articles a JOIN article_categories c ON c.article_id = a.id WHERE c.category = ?1 AND a.id != ?2 AND a.status != 'rejected' ORDER BY a.id DESC LIMIT 4").bind(cats[0], a.id).all()).results : [];
    return new Response(articlePage(a, cats, ents, related, origin), { headers: HTML_HEADERS });
  }

  if (p.startsWith("/api/admin/")) return handleAdmin(req, env, ctx, url);

  if (p === "/api/health") {
    const a = await env.DB.prepare("SELECT COUNT(*) AS total, MAX(ingested_at) AS last_ingested FROM articles").first();
    return json({ ok: true, articles: a, time: new Date().toISOString() });
  }

  if (p === "/api/status") {
    const sources = (await env.DB.prepare("SELECT id, slug, name, adapter, source_type, reliability, enabled, poll_interval_min, verified_at, last_success_at, last_error, consecutive_failures FROM sources ORDER BY id").all()).results;
    const runs = (await env.DB.prepare("SELECT r.source_id, r.started_at, r.duration_ms, r.fetched, r.inserted, r.duplicates, r.status, r.error FROM ingest_runs r WHERE r.id IN (SELECT MAX(id) FROM ingest_runs GROUP BY source_id)").all()).results;
    const by: Record<number, any> = Object.fromEntries(runs.map((r: any) => [r.source_id, r]));
    const tot = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM articles WHERE ingested_at >= datetime('now','-1 day')) AS articles_24h, (SELECT COUNT(*) FROM articles WHERE translation_status = 'pending') AS pending_translation, (SELECT COUNT(*) FROM cves) AS cves, (SELECT COUNT(*) FROM cves WHERE in_kev = 1) AS kev, (SELECT COUNT(*) FROM ingest_runs) AS runs, (SELECT MAX(started_at) FROM ingest_runs) AS last_run").first();
    const latest = await env.DB.prepare("SELECT a.id, a.original_title, a.title_es, a.ingested_at, a.published_at, s.name AS source FROM articles a JOIN sources s ON s.id = a.source_id ORDER BY a.id DESC LIMIT 1").first();
    return json({
      generated_at: new Date().toISOString(), next_run_estimate: nextRun(),
      next_run_note: "Estimación según los 5 Cron Triggers configurados (RSS cada 30 min en dos tandas, NVD cada 30, KEV y traducción por hora/30 min); cada fuente se consulta cuando vence su intervalo.",
      totals: tot, latest_article: latest ? withPath(latest) : null,
      sources: sources.map((s: any) => ({ ...s, last_run: by[s.id] ?? null })),
    });
  }

  if (p === "/api/stats") {
    const days = clampInt(q.get("days"), 30, 7, 90);
    const src = Object.fromEntries((await env.DB.prepare("SELECT slug, last_success_at FROM sources WHERE slug IN ('cisa-kev','nvd')").all()).results.map((r: any) => [r.slug, r.last_success_at]));
    const art = (await env.DB.prepare("SELECT date(ingested_at) AS d, COUNT(*) AS n FROM articles WHERE ingested_at >= datetime('now', ?1) GROUP BY d ORDER BY d").bind(`-${days} days`).all()).results;
    const kev = (await env.DB.prepare("SELECT kev_added_at AS d, COUNT(*) AS n FROM cves WHERE in_kev = 1 AND kev_added_at >= date('now', ?1) GROUP BY d ORDER BY d").bind(`-${days} days`).all()).results;
    const sev = (await env.DB.prepare("SELECT COALESCE(severity,'SIN DATO') AS d, COUNT(*) AS n FROM cves WHERE source LIKE 'nvd%' AND datetime(published_at) >= datetime('now', ?1) GROUP BY d ORDER BY n DESC").bind(`-${days} days`).all()).results;
    const last = await env.DB.prepare("SELECT MAX(ingested_at) AS t FROM articles").first();
    return json({
      window_days: days, generated_at: new Date().toISOString(),
      series: {
        articles_ingested: { title: "Noticias ingeridas por día", measures: "Artículos incorporados a la base por nuestras ingestas, agrupados por fecha de ingesta (UTC). No mide ataques ocurridos.", unit: "artículos/día", source: "Fuentes RSS habilitadas del registro de fuentes", updated_at: last?.t ?? null, limitations: "Depende de las fuentes habilitadas y de la cobertura de sus feeds; los primeros días reflejan la puesta en marcha, no el volumen real del sector.", rows: art },
        kev_added: { title: "Vulnerabilidades añadidas al catálogo KEV", measures: "CVE que CISA incorporó al catálogo de vulnerabilidades explotadas, por fecha de incorporación.", unit: "CVE/día", source: "CISA Known Exploited Vulnerabilities (JSON oficial)", updated_at: src["cisa-kev"] ?? null, limitations: "Cuenta registros del catálogo, no incidentes. La carga inicial es gradual (hasta 400 registros por ejecución), por lo que ventanas antiguas pueden estar incompletas.", rows: kev },
        cves_by_severity: { title: "CVE publicadas por severidad", measures: "CVE publicadas en la ventana, según la severidad CVSS que informa NVD.", unit: "CVE", source: "NVD API 2.0 (NIST)", updated_at: src["nvd"] ?? null, limitations: "Solo incluye CVE sincronizadas desde que se activó la ingesta; la severidad CVSS no mide riesgo real ni explotación.", rows: sev },
      },
    }, 200, 120);
  }

  if (p === "/api/cves") {
    const where: string[] = [], binds: any[] = [];
    if (q.get("kev") === "1") where.push("in_kev = 1");
    const sev = q.get("severity");
    if (sev && /^[A-Za-z]{3,10}$/.test(sev)) { binds.push(sev.toUpperCase()); where.push(`severity = ?${binds.length}`); }
    const text = q.get("q");
    if (text) { binds.push(`%${text.slice(0, 60).replace(/[%_]/g, "")}%`); where.push(`(cve_id LIKE ?${binds.length} OR description_en LIKE ?${binds.length})`); }
    const limit = clampInt(q.get("limit"), 20, 1, 50);
    const rows = (await env.DB.prepare(`SELECT cve_id, description_en, cvss_score, cvss_version, severity, published_at, last_modified_at, cwe, in_kev, kev_added_at, source, synced_at FROM cves ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(kev_added_at, published_at) DESC LIMIT ${limit}`).bind(...binds).all()).results;
    return json({ items: rows, limit }, 200, 60);
  }

  if (p === "/api/actors") {
    const rows = (await env.DB.prepare("SELECT attack_id, name, aliases, description, url, attack_version FROM actors ORDER BY name").all()).results;
    const m = Object.fromEntries((await env.DB.prepare("SELECT entity_id, COUNT(*) AS n, MAX(created_at) AS last FROM article_entities WHERE entity_type = 'actor' GROUP BY entity_id").all()).results.map((r: any) => [r.entity_id, r]));
    return json({
      items: rows.map((a: any) => ({ ...a, aliases: JSON.parse(a.aliases || "[]"), mentions: m[a.attack_id]?.n ?? 0, last_mention_ingested: m[a.attack_id]?.last ?? null })),
      note: "Perfiles de la base de conocimiento ATT&CK. Su existencia no indica actividad reciente; 'mentions' cuenta noticias ingeridas que nombran al grupo, no ataques ni atribuciones confirmadas.",
    }, 200, 300);
  }

  if (p === "/api/categories") {
    const rows = (await env.DB.prepare("SELECT c.category AS name, COUNT(*) AS n FROM article_categories c JOIN articles a ON a.id = c.article_id WHERE a.status IN ('draft','published') GROUP BY c.category ORDER BY n DESC").all()).results;
    return json({ items: rows }, 200, 120);
  }

  if (p === "/api/featured") {
    const a = await env.DB.prepare(
      `SELECT a.id, a.original_title, a.title_es, a.summary_es, a.original_excerpt, a.published_at, a.ingested_at, a.translation_status, s.name AS source, s.reliability,
              (SELECT COUNT(*) > 0 FROM article_entities e WHERE e.article_id = a.id AND e.entity_type = 'cve') AS has_cve,
              (SELECT COUNT(*) > 0 FROM article_entities e WHERE e.article_id = a.id AND e.entity_type = 'actor') AS has_actor,
              (SELECT group_concat(category, '|') FROM article_categories c WHERE c.article_id = a.id) AS categories
       FROM articles a JOIN sources s ON s.id = a.source_id
       WHERE a.status = 'published' AND datetime(COALESCE(a.published_at, a.ingested_at)) >= datetime('now', '-72 hours')
       ORDER BY ((CASE s.reliability WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END) + (SELECT COUNT(*) > 0 FROM article_entities e WHERE e.article_id = a.id AND e.entity_type = 'cve') + (SELECT COUNT(*) > 0 FROM article_entities e WHERE e.article_id = a.id AND e.entity_type = 'actor')) DESC,
                datetime(COALESCE(a.published_at, a.ingested_at)) DESC LIMIT 1`).first();
    const reasons = a ? [a.reliability === "high" ? "fuente de alta fiabilidad" : a.reliability === "medium" ? "fuente de fiabilidad media" : null, a.has_cve ? "menciona una CVE" : null, a.has_actor ? "menciona un grupo de ATT&CK" : null].filter(Boolean) : [];
    return json({ item: a ? { ...withPath(a), reasons } : null, criteria: "Entre las noticias publicadas en las últimas 72 h: fiabilidad de la fuente (alta +2, media +1), mención de una CVE (+1) y mención de un grupo ATT&CK (+1). Desempata la más reciente. No hay selección manual." }, 200, 120);
  }

  if (p === "/api/articles") {
    const limit = clampInt(q.get("limit"), 20, 1, 50), offset = clampInt(q.get("offset"), 0, 0, 5000);
    const where = ["a.status IN ('draft','published')"], binds: any[] = [];
    const text = q.get("q");
    if (text) { binds.push(`%${text.slice(0, 60).replace(/[%_]/g, "")}%`); where.push(`(a.title_es LIKE ?${binds.length} OR a.original_title LIKE ?${binds.length} OR a.summary_es LIKE ?${binds.length} OR a.original_excerpt LIKE ?${binds.length})`); }
    const cat = q.get("cat");
    if (cat) { binds.push(cat.slice(0, 60)); where.push(`EXISTS (SELECT 1 FROM article_categories c WHERE c.article_id = a.id AND c.category = ?${binds.length})`); }
    const src = q.get("source");
    if (src && /^[a-z0-9-]{2,41}$/.test(src)) { binds.push(src); where.push(`s.slug = ?${binds.length}`); }
    const rows = (await env.DB.prepare(
      `SELECT a.id, a.canonical_url, a.original_title, a.title_es, a.summary_es, a.original_excerpt, a.published_at, a.ingested_at, a.translation_status, a.status, s.name AS source, s.slug AS source_slug,
              (SELECT group_concat(category, '|') FROM article_categories c WHERE c.article_id = a.id) AS categories
       FROM articles a JOIN sources s ON s.id = a.source_id WHERE ${where.join(" AND ")}
       ORDER BY datetime(COALESCE(a.published_at, a.ingested_at)) DESC LIMIT ${limit} OFFSET ${offset}`).bind(...binds).all()).results;
    return json({ items: rows.map(withPath), limit, offset, filters: { q: text, cat, source: src } }, 200, 60);
  }

  return json({ error: "no_encontrado" }, 404);
}
