import { parseFeed } from "./feed.ts";
import { classify, findActors, findCves, normTitle } from "./enrich.ts";

const UA = { "user-agent": "HackerNewsArBot/0.2 (+https://hackernews.com.ar)" };
const MAX_TRANSLATE = 5;
const MAX_KEV_PER_RUN = 400;

type R = { fetched: number; inserted: number; duplicates: number; status: "ok" | "not_modified" | "error"; error?: string; etag?: string | null; lm?: string | null };

async function sha1(s: string) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export type Group = "all" | "rss0" | "rss1" | "kev" | "nvd" | "translate";

// Cada grupo corre en su propio Cron Trigger para que cada ejecución tenga su propio presupuesto de CPU/subrequests.
export async function ingestAll(env: any, force = false, group: Group = "all") {
  const due = force ? "" : "AND (last_success_at IS NULL OR datetime(last_success_at, '+' || poll_interval_min || ' minutes') <= datetime('now', '+1 minute'))";
  let scope = "";
  if (group === "rss0" || group === "rss1") scope = `AND adapter = 'rss' AND id % 2 = ${group === "rss1" ? 1 : 0}`;
  else if (group === "kev" || group === "nvd") scope = `AND adapter = '${group}'`;
  else if (group === "translate") scope = "AND 0";
  const { results } = await env.DB.prepare(`SELECT * FROM sources WHERE enabled = 1 ${scope} ${due} ORDER BY id`).all();
  const out = [];
  for (const s of results) out.push(await runSource(env, s));
  const translated = group === "all" || group === "translate" ? await translatePending(env) : 0;
  return { sources: out, translated };
}

async function runSource(env: any, s: any) {
  const t0 = Date.now();
  let r: R;
  try {
    r = s.adapter === "kev" ? await kev(env, s) : s.adapter === "nvd" ? await nvd(env, s) : await rss(env, s);
  } catch (e: any) {
    r = { fetched: 0, inserted: 0, duplicates: 0, status: "error", error: String(e?.message || e).slice(0, 300) };
  }
  const ok = r.status !== "error";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ingest_runs(source_id,adapter,started_at,finished_at,duration_ms,fetched,inserted,duplicates,status,error) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")
      .bind(s.id, s.adapter, new Date(t0).toISOString(), new Date().toISOString(), Date.now() - t0, r.fetched, r.inserted, r.duplicates, r.status, r.error ?? null),
    ok
      ? env.DB.prepare("UPDATE sources SET etag = COALESCE(?1, etag), last_modified = COALESCE(?2, last_modified), last_success_at = datetime('now'), verified_at = COALESCE(verified_at, datetime('now')), last_error = NULL, consecutive_failures = 0 WHERE id = ?3").bind(r.etag ?? null, r.lm ?? null, s.id)
      : env.DB.prepare("UPDATE sources SET last_error = ?1, consecutive_failures = consecutive_failures + 1 WHERE id = ?2").bind(r.error, s.id),
  ]);
  return { source: s.slug, ...r };
}

async function rss(env: any, s: any): Promise<R> {
  const h: Record<string, string> = { ...UA, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" };
  if (s.etag) h["if-none-match"] = s.etag;
  if (s.last_modified) h["if-modified-since"] = s.last_modified;
  const res = await fetch(s.feed_url, { headers: h });
  if (res.status === 304) return { fetched: 0, inserted: 0, duplicates: 0, status: "not_modified" };
  if (!res.ok) throw new Error("HTTP " + res.status);
  const items = parseFeed(await res.text()).slice(0, 40);
  if (!items.length) throw new Error("feed sin entradas reconocibles");
  const hashes = await Promise.all(items.map((i) => sha1(normTitle(i.title))));
  const ex = await env.DB.prepare(`SELECT content_hash FROM articles WHERE content_hash IN (${hashes.map((_, i) => "?" + (i + 1)).join(",")})`).bind(...hashes).all();
  const seen = new Set<string>(ex.results.map((x: any) => x.content_hash));
  const todo: { it: (typeof items)[0]; h: string }[] = [];
  items.forEach((it, i) => { if (!seen.has(hashes[i])) { seen.add(hashes[i]); todo.push({ it, h: hashes[i] }); } });
  let inserted = 0;
  if (todo.length) {
    const es = s.language === "es";
    const rows = await env.DB.batch(todo.map(({ it, h }) =>
      env.DB.prepare("INSERT OR IGNORE INTO articles(source_id,canonical_url,guid,original_title,original_excerpt,published_at,original_lang,content_hash,title_es,summary_es,translation_status,summary_status,status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12) RETURNING id")
        .bind(s.id, it.url, it.guid, it.title, it.excerpt, it.publishedAt, s.language, h, es ? it.title : null, es ? it.excerpt : null, es ? "skipped" : "pending", es ? "published" : "draft")));
    const actors = (await env.DB.prepare("SELECT attack_id,name,aliases FROM actors").all()).results;
    const st: any[] = [];
    rows.forEach((x: any, i: number) => {
      const id = x.results?.[0]?.id;
      if (!id) return;
      inserted++;
      const text = todo[i].it.title + " " + todo[i].it.excerpt;
      for (const c of classify(text)) st.push(env.DB.prepare("INSERT OR IGNORE INTO article_categories(article_id,category) VALUES (?1,?2)").bind(id, c));
      for (const cve of findCves(text)) st.push(env.DB.prepare("INSERT OR IGNORE INTO article_entities(article_id,entity_type,entity_id,evidence_status,provenance) VALUES (?1,'cve',?2,'reported',?3)").bind(id, cve, "CVE mencionado en el título o extracto de la fuente"));
      for (const a of findActors(text, actors)) st.push(env.DB.prepare("INSERT OR IGNORE INTO article_entities(article_id,entity_type,entity_id,evidence_status,provenance) VALUES (?1,'actor',?2,'reported',?3)").bind(id, a, "Nombre mencionado en el título o extracto de la fuente; no implica atribución"));
    });
    if (st.length) await env.DB.batch(st);
  }
  return { fetched: items.length, inserted, duplicates: items.length - inserted, status: "ok", etag: res.headers.get("etag"), lm: res.headers.get("last-modified") };
}

async function kev(env: any, s: any): Promise<R> {
  const res = await fetch(s.feed_url, { headers: UA });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const vulns: any[] = (await res.json()).vulnerabilities;
  if (!Array.isArray(vulns)) throw new Error("JSON de KEV sin 'vulnerabilities'");
  const known = new Set<string>((await env.DB.prepare("SELECT cve_id FROM cves WHERE in_kev = 1").all()).results.map((r: any) => r.cve_id));
  const fresh = vulns.filter((v) => v.cveID && !known.has(v.cveID)).sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded))).slice(0, MAX_KEV_PER_RUN);
  for (const part of chunk(fresh, 100)) {
    await env.DB.batch(part.map((v) =>
      env.DB.prepare("INSERT INTO cves(cve_id,description_en,in_kev,kev_added_at,source) VALUES (?1,?2,1,?3,'cisa-kev') ON CONFLICT(cve_id) DO UPDATE SET in_kev = 1, kev_added_at = excluded.kev_added_at, source = CASE WHEN cves.source LIKE 'nvd%' THEN 'nvd+cisa-kev' ELSE cves.source END")
        .bind(v.cveID, `[${v.vendorProject} ${v.product}] ${v.vulnerabilityName}: ${v.shortDescription}`.slice(0, 700), v.dateAdded)));
  }
  return { fetched: vulns.length, inserted: fresh.length, duplicates: vulns.length - fresh.length, status: "ok" };
}

async function nvd(env: any, s: any): Promise<R> {
  const last = (await env.DB.prepare("SELECT value FROM sync_state WHERE key = 'nvd_last_end'").first())?.value;
  const end = new Date();
  let start = last ? new Date(last) : new Date(end.getTime() - 6 * 3600e3);
  if (end.getTime() - start.getTime() > 24 * 3600e3) start = new Date(end.getTime() - 24 * 3600e3);
  const f = (d: Date) => d.toISOString().slice(0, -1);
  const headers: Record<string, string> = { ...UA };
  if (env.NVD_API_KEY) headers.apiKey = env.NVD_API_KEY;
  const res = await fetch(`${s.feed_url}?lastModStartDate=${f(start)}&lastModEndDate=${f(end)}&resultsPerPage=500`, { headers });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j: any = await res.json();
  const list: any[] = j.vulnerabilities || [];
  const rows = list.map((x) => {
    const c = x.cve, m = c.metrics || {};
    const met = m.cvssMetricV40?.[0] || m.cvssMetricV31?.[0] || m.cvssMetricV30?.[0] || m.cvssMetricV2?.[0];
    const desc = (c.descriptions || []).find((d: any) => d.lang === "en")?.value ?? null;
    const cwe = (c.weaknesses || []).flatMap((w: any) => w.description || []).map((d: any) => d.value).filter((v: string) => /^CWE-/.test(v))[0] ?? null;
    return [c.id, desc && desc.slice(0, 1500), met?.cvssData?.baseScore ?? null, met?.cvssData?.version ?? null, met?.baseSeverity ?? met?.cvssData?.baseSeverity ?? null, c.published ?? null, c.lastModified ?? null, cwe];
  });
  for (const part of chunk(rows, 100)) {
    await env.DB.batch(part.map((r) =>
      env.DB.prepare("INSERT INTO cves(cve_id,description_en,cvss_score,cvss_version,severity,published_at,last_modified_at,cwe,source) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'nvd') ON CONFLICT(cve_id) DO UPDATE SET description_en = excluded.description_en, cvss_score = excluded.cvss_score, cvss_version = excluded.cvss_version, severity = excluded.severity, published_at = excluded.published_at, last_modified_at = excluded.last_modified_at, cwe = excluded.cwe, synced_at = datetime('now'), source = CASE WHEN cves.in_kev = 1 THEN 'nvd+cisa-kev' ELSE 'nvd' END").bind(...r)));
  }
  await env.DB.prepare("INSERT INTO sync_state(key,value) VALUES ('nvd_last_end',?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(end.toISOString()).run();
  const warn = j.totalResults > list.length ? `aviso: NVD devolvió ${list.length} de ${j.totalResults}; el resto de la ventana no se sincronizó` : undefined;
  return { fetched: list.length, inserted: list.length, duplicates: 0, status: "ok", error: warn };
}

async function tr(env: any, text: string): Promise<string> {
  const r = await env.AI.run("@cf/meta/m2m100-1.2b", { text, source_lang: "english", target_lang: "spanish" });
  return String(r?.translated_text ?? "").trim();
}

export async function translatePending(env: any): Promise<number> {
  if (!env.AI) return 0;
  const { results } = await env.DB.prepare(`SELECT id, original_title, original_excerpt FROM articles WHERE translation_status = 'pending' AND translation_attempts < 3 AND original_lang != 'es' ORDER BY COALESCE(published_at, ingested_at) DESC LIMIT ${MAX_TRANSLATE}`).all();
  let n = 0;
  for (const a of results) {
    try {
      const t = await tr(env, a.original_title);
      if (t.length < a.original_title.length * 0.3) throw new Error("traducción de título sospechosa");
      const sm = a.original_excerpt ? await tr(env, a.original_excerpt.slice(0, 400)) : "";
      await env.DB.prepare("UPDATE articles SET title_es = ?1, summary_es = ?2, translation_status = 'done', summary_status = ?3, translation_provider = 'workers-ai:m2m100-1.2b', status = 'published', updated_at = datetime('now') WHERE id = ?4")
        .bind(t, sm || null, sm ? "done" : "skipped", a.id).run();
      n++;
    } catch {
      await env.DB.prepare("UPDATE articles SET translation_attempts = translation_attempts + 1, translation_status = CASE WHEN translation_attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END WHERE id = ?1").bind(a.id).run();
    }
  }
  return n;
}
