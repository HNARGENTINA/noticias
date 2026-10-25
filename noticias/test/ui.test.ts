import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle } from "../src/api.ts";
import { ingestAll } from "../src/ingest.ts";

function d1(db: DatabaseSync) {
  const mk = (sql: string) => { let p: any[] = []; const st: any = { _sql: sql, _p: () => p, bind: (...a: any[]) => { p = a; return st; },
    all: async () => ({ results: db.prepare(sql).all(...p) }), first: async () => db.prepare(sql).get(...p) ?? null, run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...p).changes) } }) }; return st; };
  return { prepare: mk, batch: async (s: any[]) => s.map((x) => /returning/i.test(x._sql) ? { results: db.prepare(x._sql).all(...x._p()) } : { results: [], meta: { changes: Number(db.prepare(x._sql).run(...x._p()).changes) } }) };
}
const html = readFileSync("public/index.html", "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)![1];

async function runView(env: any, hash: string) {
  const app: any = { innerHTML: "" };
  const ctx: any = {
    document: { querySelector: (s: string) => (s === "#app" ? app : null), querySelectorAll: () => [], addEventListener() {} },
    location: { hash }, addEventListener() {}, scrollTo() {}, scrollY: 0,
    fetch: async (u: string) => (await handle(new Request("https://x.test" + u), env, { waitUntil() {} })),
    Date, Math, JSON, Promise, URL, URLSearchParams, Request, Response, Object, String, Number, isNaN, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  await new Promise((r) => setTimeout(r, 50));
  return app.innerHTML as string;
}

test("UI con base vacía: estados vacíos honestos, sin datos inventados", async () => {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init", "0002_seed_sources", "0003_ingest_runs", "0004_actors_mitre", "0005_source_verification"]) db.exec(readFileSync(`migrations/${f}.sql`, "utf8"));
  const env: any = { DB: d1(db) };
  const home = await runView(env, "");
  assert.match(home, /Más allá de la/); assert.doesNotMatch(home, /sin ruido/); assert.match(home, /Todavía no hay noticias ingeridas/); assert.match(home, /sin ejecuciones aún/);
  assert.doesNotMatch(home, /undefined|NaN|\[object/);
  const intel = await runView(env, "#/inteligencia");
  assert.match(intel, /Sin registros en este período/); assert.match(intel, /Qué mide/); assert.match(intel, /attack\.mitre\.org\/techniques\/T1566/);
  assert.match(intel, /ANALÍTICO/); assert.doesNotMatch(intel, /undefined|NaN/);
  const act = await runView(env, "#/actores");
  assert.match(act, /G0007/); assert.match(act, /Fancy Bear/); assert.match(act, /Menciones en noticias ingeridas: <b>0<\/b>/);
  const est = await runView(env, "#/estado");
  assert.match(est, /ninguna todavía/); assert.match(est, /sin ejecutar/);
});

test("UI con datos ingeridos: portada, detalle y estado muestran registros reales persistidos", async () => {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init", "0002_seed_sources", "0003_ingest_runs", "0004_actors_mitre", "0005_source_verification"]) db.exec(readFileSync(`migrations/${f}.sql`, "utf8"));
  db.exec("UPDATE sources SET enabled = 0 WHERE slug != 'thehackernews'");
  const env: any = { DB: d1(db), AI: { run: async (_m: string, { text }: any) => ({ translated_text: "ES: " + text }) } };
  globalThis.fetch = (async () => new Response(`<rss><channel><item><title>&lt;img src=x onerror=alert(1)&gt; APT28 abuses CVE-2026-1111</title><link>https://thn.test/a</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>Texto</description></item></channel></rss>`)) as any;
  await ingestAll(env, true);
  const home = await runView(env, "");
  assert.match(home, /ES: /); assert.match(home, /Traducción automática/); assert.doesNotMatch(home, /<img/i); assert.doesNotMatch(home, /undefined/);
  const est = await runView(env, "#/estado");
  assert.match(est, /<span class="ok">ok<\/span>/); assert.match(est, /ÚLTIMO ARTÍCULO INCORPORADO/);
  const act = await runView(env, "#/actores");
  assert.match(act, /Menciones en noticias ingeridas: <b>1<\/b>/);
});
