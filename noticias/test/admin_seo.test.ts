import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/api.ts";
import { ingestAll } from "../src/ingest.ts";
import { setup, ctx } from "./helpers.ts";

const RSS = `<rss><channel>
<item><title>APT28 exploits CVE-2026-1111 in mail servers</title><link>https://thn.test/a</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>Fancy Bear abusing a zero-day flaw.</description></item>
<item><title>Ransomware gang hits hospitals</title><link>https://thn.test/b</link><pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate><description>Extortion wave.</description></item></channel></rss>`;
const AI = { run: async (_m: string, { text }: any) => ({ translated_text: "ES: " + text }) };
const req = (path: string, init: any = {}) => new Request("https://hn.test" + path, init);
const admin = (path: string, method = "GET", body?: any, token = "secreto") => req(path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const mockFeed = (xml = RSS, status = 200) => { globalThis.fetch = (async () => new Response(xml, { status })) as any; };
const NEW = { slug: "incibe", name: "INCIBE-CERT", url: "https://www.incibe.es", feed_url: "https://www.incibe.es/feed", language: "es", source_type: "cert" };

test("admin: sin token 503, token malo 401 y bloqueo 429 tras 5 fallos", async () => {
  const { env } = setup();
  assert.equal((await handle(admin("/api/admin/sources"), env, ctx)).status, 503);
  env.ADMIN_TOKEN = "secreto";
  for (let i = 0; i < 5; i++) assert.equal((await handle(admin("/api/admin/sources", "GET", undefined, "mal"), env, ctx)).status, 401);
  assert.equal((await handle(admin("/api/admin/sources", "GET", undefined, "mal"), env, ctx)).status, 429);
  assert.equal((await handle(admin("/api/admin/sources"), env, ctx)).status, 429); // bloqueada incluso con token correcto
});

test("admin: alta deshabilitada, prueba obligatoria antes de activar, y validación de URLs", async () => {
  const { env, db } = setup({ ADMIN_TOKEN: "secreto" });
  assert.equal((await handle(admin("/api/admin/sources", "POST", { ...NEW, feed_url: "http://localhost/feed" }), env, ctx)).status, 400);
  assert.equal((await handle(admin("/api/admin/sources", "POST", { ...NEW, feed_url: "https://10.0.0.5/feed" }), env, ctx)).status, 400);
  assert.equal((await handle(admin("/api/admin/sources", "POST", { ...NEW, feed_url: "http://site.test/feed" }), env, ctx)).status, 400);
  const c = await handle(admin("/api/admin/sources", "POST", NEW), env, ctx); assert.equal(c.status, 201);
  const { id } = await c.json() as any;
  assert.equal((await handle(admin("/api/admin/sources", "POST", NEW), env, ctx)).status, 409);
  assert.equal((await handle(admin(`/api/admin/sources/${id}`, "PATCH", { enabled: true }), env, ctx)).status, 409); // sin verificar
  mockFeed("<html>no es un feed</html>");
  const bad = await (await handle(admin(`/api/admin/sources/${id}/test`, "POST"), env, ctx)).json() as any; assert.equal(bad.ok, false);
  assert.equal((await handle(admin(`/api/admin/sources/${id}`, "PATCH", { enabled: true }), env, ctx)).status, 409);
  mockFeed();
  const ok = await (await handle(admin(`/api/admin/sources/${id}/test`, "POST"), env, ctx)).json() as any;
  assert.equal(ok.ok, true); assert.equal(ok.entries, 2);
  assert.equal((await handle(admin(`/api/admin/sources/${id}`, "PATCH", { enabled: true, poll_interval_min: 30 }), env, ctx)).status, 200);
  assert.equal((db.prepare("SELECT enabled FROM sources WHERE id = ?").get(id) as any).enabled, 1);
  assert.equal((await handle(admin(`/api/admin/sources/${id}`, "PATCH", { poll_interval_min: 5 }), env, ctx)).status, 400);
  // pausar sin pedir verificación
  assert.equal((await handle(admin(`/api/admin/sources/${id}`, "PATCH", { enabled: false }), env, ctx)).status, 200);
  // cambiar la URL del feed invalida la verificación y la deja deshabilitada
  await handle(admin(`/api/admin/sources/${id}`, "PATCH", { feed_url: "https://www.incibe.es/otro" }), env, ctx);
  const row: any = db.prepare("SELECT enabled, verified_at FROM sources WHERE id = ?").get(id); assert.equal(row.enabled, 0); assert.equal(row.verified_at, null);
});

test("crons: cada grupo ejecuta solo lo suyo y los dos tramos RSS no se solapan", async () => {
  const { env, db } = setup({ AI });
  mockFeed(RSS);
  globalThis.fetch = (async (u: any) => String(u).includes("known_exploited") ? Response.json({ vulnerabilities: [] }) : String(u).includes("cves/2.0") ? Response.json({ totalResults: 0, vulnerabilities: [] }) : new Response(RSS)) as any;
  const k = await ingestAll(env, true, "kev"); assert.deepEqual(k.sources.map((s: any) => s.source), ["cisa-kev"]);
  const n = await ingestAll(env, true, "nvd"); assert.deepEqual(n.sources.map((s: any) => s.source), ["nvd"]);
  const a = (await ingestAll(env, true, "rss0")).sources.map((s: any) => s.source), b = (await ingestAll(env, true, "rss1")).sources.map((s: any) => s.source);
  assert.equal(a.filter((x: string) => b.includes(x)).length, 0);
  assert.equal(a.length + b.length, (db.prepare("SELECT COUNT(*) n FROM sources WHERE adapter = 'rss' AND enabled = 1").get() as any).n);
  const t = await ingestAll(env, true, "translate"); assert.equal(t.sources.length, 0); assert.ok(t.translated > 0);
});

test("SEO: página de artículo con canonical, JSON-LD, escape y redirección de slug; borradores noindex", async () => {
  const { env, db } = setup({ AI });
  db.exec("UPDATE sources SET enabled = 0 WHERE slug != 'thehackernews'");
  globalThis.fetch = (async () => new Response(RSS.replace("APT28 exploits", "<script>alert(1)</script> APT28 exploits"))) as any;
  await ingestAll(env, true, "rss0"); await ingestAll(env, true, "rss1");
  await ingestAll(env, true, "translate");
  const list = await (await handle(req("/api/articles"), env, ctx)).json() as any;
  const a = list.items.find((x: any) => /APT28/.test(x.original_title));
  assert.match(a.path, /^\/noticias\/\d+-es-/);
  const res = await handle(req(a.path), env, ctx); const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://hn.test${a.path}">`));
  assert.doesNotMatch(html, /<script>alert/); // el parser ya elimina etiquetas al ingerir
  db.exec(`INSERT INTO articles(source_id,canonical_url,original_title,original_lang,translation_status,status,title_es,summary_es) VALUES (1,'https://x.test/xss','x','en','done','published','<img src=x onerror=alert(1)> Hola','</p><script>alert(2)</script>')`);
  const xid: any = db.prepare("SELECT id FROM articles WHERE canonical_url='https://x.test/xss'").get();
  const xr = await handle(req(`/noticias/${xid.id}-x`), env, ctx);
  const xh = await (xr.status === 301 ? await handle(req(new URL(xr.headers.get("location")!).pathname), env, ctx) : xr).text();
  assert.doesNotMatch(xh, /<img src=x/); assert.doesNotMatch(xh, /<script>alert\(2\)/); assert.match(xh, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
  assert.equal(ld["@type"], "NewsArticle"); assert.equal(ld.isBasedOn, "https://thn.test/a"); assert.equal(ld.inLanguage, "es");
  assert.match(html, /CVE-2026-1111/); assert.match(html, /no confirma una atribución/); assert.doesNotMatch(html, /noindex/);
  assert.equal(res.headers.get("content-security-policy")!.includes("script-src"), false);
  const red = await handle(req(`/noticias/${a.id}-slug-incorrecto`), env, ctx); assert.equal(red.status, 301);
  assert.equal((await handle(req("/noticias/99999-x"), env, ctx)).status, 404);
  // borrador sin traducir -> noindex y fuera del sitemap
  db.exec("INSERT INTO articles(source_id,canonical_url,original_title,original_lang,translation_status,status) VALUES (1,'https://x.test/draft','Draft only','en','pending','draft')");
  const dr: any = db.prepare("SELECT id FROM articles WHERE canonical_url='https://x.test/draft'").get();
  const dh = await (await handle(req(`/noticias/${dr.id}-draft-only`), env, ctx)).text(); assert.match(dh, /noindex/); assert.doesNotMatch(dh, /application\/ld\+json/);
  const sm = await (await handle(req("/sitemap.xml"), env, ctx)).text();
  assert.match(sm, /<urlset/); assert.ok(sm.includes(a.path)); assert.ok(!sm.includes("draft-only"));
  const rb = await (await handle(req("/robots.txt"), env, ctx)).text(); assert.match(rb, /Sitemap: https:\/\/hn\.test\/sitemap\.xml/); assert.match(rb, /Disallow: \/api\//);
});

test("búsqueda, categorías y destacado con criterio transparente", async () => {
  const { env, db } = setup({ AI });
  db.exec("UPDATE sources SET enabled = 0 WHERE slug != 'thehackernews'");
  const now = new Date().toUTCString();
  mockFeed(RSS.replaceAll("Tue, 20 Oct 2026 10:00:00 GMT", now).replaceAll("Tue, 20 Oct 2026 09:00:00 GMT", now));
  await ingestAll(env, true, "rss0"); await ingestAll(env, true, "rss1"); await ingestAll(env, true, "translate");
  const f = await (await handle(req("/api/articles?q=hospitals"), env, ctx)).json() as any; assert.equal(f.items.length, 1);
  const none = await (await handle(req("/api/articles?q=inexistente"), env, ctx)).json() as any; assert.equal(none.items.length, 0);
  const inj = await handle(req("/api/articles?q=%27%3B%20DROP%20TABLE%20articles%3B--"), env, ctx); assert.equal(inj.status, 200);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM articles").get() as any).n, 2);
  const cats = await (await handle(req("/api/categories"), env, ctx)).json() as any; assert.ok(cats.items.length >= 1);
  const byCat = await (await handle(req("/api/articles?cat=" + encodeURIComponent("Ransomware y cibercrimen")), env, ctx)).json() as any; assert.equal(byCat.items.length, 1);
  const ft = await (await handle(req("/api/featured"), env, ctx)).json() as any;
  assert.match(ft.item.original_title, /APT28/); // tiene CVE + grupo mencionados
  assert.ok(ft.item.reasons.includes("menciona una CVE") && ft.item.reasons.includes("menciona un grupo de ATT&CK"));
  assert.match(ft.criteria, /No hay selección manual/);
});
