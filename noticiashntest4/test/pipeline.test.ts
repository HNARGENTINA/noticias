import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ingestAll } from "../src/ingest.ts";
import { handle } from "../src/api.ts";

// Adaptador minimo que imita la API de D1 sobre SQLite (solo para pruebas).
function d1(db: DatabaseSync) {
  const mk = (sql: string) => {
    let p: any[] = [];
    const st: any = {
      _sql: sql, _p: () => p,
      bind: (...a: any[]) => { p = a; return st; },
      all: async () => ({ results: db.prepare(sql).all(...p) }),
      first: async () => db.prepare(sql).get(...p) ?? null,
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...p).changes) } }),
    };
    return st;
  };
  return {
    prepare: mk,
    batch: async (sts: any[]) => sts.map((s) => /returning/i.test(s._sql)
      ? { results: db.prepare(s._sql).all(...s._p()) }
      : { results: [], meta: { changes: Number(db.prepare(s._sql).run(...s._p()).changes) } }),
  };
}

const RSS = `<rss><channel>
<item><title>APT28 exploits CVE-2026-1111 in mail servers</title><link>https://thn.test/a?utm_source=x</link><guid>a</guid><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>Fancy Bear campaign abusing a zero-day flaw.</description></item>
<item><title>New ransomware gang hits hospitals</title><link>https://thn.test/b</link><guid>b</guid><pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate><description>Extortion wave.</description></item>
</channel></rss>`;
const KEV = { vulnerabilities: [
  { cveID: "CVE-2026-1111", vendorProject: "Acme", product: "Mail", vulnerabilityName: "Acme Mail RCE", shortDescription: "RCE in Mail.", dateAdded: "2026-10-19" },
  { cveID: "CVE-2025-0001", vendorProject: "Old", product: "Thing", vulnerabilityName: "Old bug", shortDescription: "Old.", dateAdded: "2025-01-01" } ] };
const NVD = { totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2026-1111", published: "2026-10-18T10:00:00.000", lastModified: "2026-10-20T10:00:00.000",
  descriptions: [{ lang: "en", value: "RCE in Acme Mail." }], metrics: { cvssMetricV31: [{ baseSeverity: "CRITICAL", cvssData: { baseScore: 9.8, version: "3.1" } }] },
  weaknesses: [{ description: [{ lang: "en", value: "CWE-94" }] }] } }] };

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init", "0002_seed_sources", "0003_ingest_runs", "0004_actors_mitre", "0005_source_verification"]) db.exec(readFileSync(`migrations/${f}.sql`, "utf8"));
  db.exec("UPDATE sources SET enabled = 0 WHERE slug NOT IN ('thehackernews','cisa-kev','nvd','bleepingcomputer')");
  const env: any = { DB: d1(db), AI: { run: async (_m: string, { text }: any) => ({ translated_text: "ES: " + text }) } };
  return { db, env };
}
const mockFetch = (fail: string[] = []) => {
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    if (fail.some((f) => url.includes(f))) return new Response("boom", { status: 503 });
    if (url.includes("thehackernews") || url.includes("TheHackersNews")) return new Response(RSS, { headers: { etag: '"e1"' } });
    if (url.includes("known_exploited")) return Response.json(KEV);
    if (url.includes("cves/2.0")) return Response.json(NVD);
    return new Response("<rss><channel></channel></rss>");
  }) as any;
};
const call = async (env: any, path: string) => (await handle(new Request("https://x.test" + path), env, { waitUntil() {} })).json() as Promise<any>;

test("ingesta completa: artículos, CVE, KEV, NVD, traducción y registro de ejecuciones", async () => {
  const { db, env } = setup(); mockFetch();
  const r = await ingestAll(env, true);
  const thn = r.sources.find((s: any) => s.source === "thehackernews")!;
  assert.equal(thn.status, "ok"); assert.equal(thn.inserted, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM articles").get()!.n, 2);
  assert.equal(r.translated, 2);
  const a: any = db.prepare("SELECT * FROM articles WHERE original_title LIKE 'APT28%'").get();
  assert.equal(a.canonical_url, "https://thn.test/a"); // sin utm
  assert.match(a.title_es, /^ES: APT28/); assert.equal(a.status, "published"); assert.equal(a.translation_provider, "workers-ai:m2m100-1.2b");
  const ents: any[] = db.prepare("SELECT entity_type, entity_id, evidence_status FROM article_entities WHERE article_id = ?").all(a.id);
  assert.deepEqual(ents.map((e) => e.entity_type + ":" + e.entity_id).sort(), ["actor:G0007", "cve:CVE-2026-1111"]);
  assert.ok(ents.every((e) => e.evidence_status === "reported")); // mención ≠ atribución
  const cats = db.prepare("SELECT category FROM article_categories WHERE article_id = ?").all(a.id).map((x: any) => x.category);
  assert.ok(cats.includes("Explotación y zero-days") && cats.includes("APT y ciberespionaje"));
  const cve: any = db.prepare("SELECT * FROM cves WHERE cve_id = 'CVE-2026-1111'").get();
  assert.equal(cve.in_kev, 1); assert.equal(cve.severity, "CRITICAL"); assert.equal(cve.cvss_score, 9.8); assert.equal(cve.cwe, "CWE-94"); assert.equal(cve.source, "nvd+cisa-kev");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cves WHERE in_kev = 1").get()!.n, 2);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM ingest_runs").get()!.n >= 3);
});

test("deduplicación: segunda ejecución no inserta nada", async () => {
  const { db, env } = setup(); mockFetch();
  await ingestAll(env, true);
  const r2 = await ingestAll(env, true);
  const thn = r2.sources.find((s: any) => s.source === "thehackernews")!;
  assert.equal(thn.inserted, 0); assert.equal(thn.duplicates, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM articles").get()!.n, 2);
});

test("tolerancia a fallos: una fuente cae y las demás siguen; el error se registra", async () => {
  const { db, env } = setup(); mockFetch(["known_exploited"]);
  const r = await ingestAll(env, true);
  assert.equal(r.sources.find((s: any) => s.source === "cisa-kev")!.status, "error");
  assert.equal(r.sources.find((s: any) => s.source === "thehackernews")!.status, "ok");
  const s: any = db.prepare("SELECT last_error, consecutive_failures FROM sources WHERE slug = 'cisa-kev'").get();
  assert.match(s.last_error, /503/); assert.equal(s.consecutive_failures, 1);
});

test("sin proveedor de IA: los artículos quedan en borrador, sin inventar traducción", async () => {
  const { db, env } = setup(); mockFetch(); delete env.AI;
  await ingestAll(env, true);
  const a: any = db.prepare("SELECT title_es, status, translation_status FROM articles LIMIT 1").get();
  assert.equal(a.title_es, null); assert.equal(a.status, "draft"); assert.equal(a.translation_status, "pending");
});

test("API: status, stats, cves, actores y detalle devuelven datos persistidos", async () => {
  const { env } = setup(); mockFetch();
  await ingestAll(env, true);
  const st = await call(env, "/api/status");
  assert.equal(st.totals.articles, 2); assert.ok(st.sources.find((s: any) => s.slug === "nvd").last_run.fetched === 1);
  const stats = await call(env, "/api/stats?days=30");
  assert.ok(stats.series.kev_added.rows.length >= 1); assert.equal(stats.series.cves_by_severity.rows[0].d, "CRITICAL");
  assert.ok(stats.series.articles_ingested.limitations.length > 10);
  const cv = await call(env, "/api/cves?kev=1&limit=5"); assert.equal(cv.items[0].cve_id, "CVE-2026-1111");
  const ac = await call(env, "/api/actors"); const apt28 = ac.items.find((a: any) => a.attack_id === "G0007");
  assert.equal(apt28.mentions, 1); assert.ok(apt28.aliases.includes("Fancy Bear"));
  const list = await call(env, "/api/articles"); assert.equal(list.items.length, 2);
  assert.match(list.items[0].path, /^\/noticias\/\d+-/); // el detalle ahora es una página renderizada en servidor
});

test("admin: sin token configurado o con token incorrecto no ejecuta nada", async () => {
  const { env } = setup();
  const noCfg = await handle(new Request("https://x.test/api/admin/ingest", { method: "POST" }), env, { waitUntil() {} });
  assert.equal(noCfg.status, 503);
  env.ADMIN_TOKEN = "secreto";
  const bad = await handle(new Request("https://x.test/api/admin/ingest", { method: "POST", headers: { authorization: "Bearer otro" } }), env, { waitUntil() {} });
  assert.equal(bad.status, 401);
});
