import { parseFeed } from "./feed.ts";

const json = (data: unknown, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      const a = await env.DB.prepare("SELECT COUNT(*) AS total, MAX(ingested_at) AS last_ingested FROM articles").first();
      const s = await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(enabled),0) AS enabled, MAX(last_success_at) AS last_success FROM sources").first();
      return json({ ok: true, articles: a, sources: s, time: new Date().toISOString() });
    }
    if (url.pathname === "/api/articles") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.canonical_url, a.original_title, a.title_es, a.summary_es, a.published_at,
                a.translation_status, a.status, s.name AS source
         FROM articles a JOIN sources s ON s.id = a.source_id
         WHERE a.status IN ('draft','published')
         ORDER BY COALESCE(a.published_at, a.ingested_at) DESC LIMIT ?1 OFFSET ?2`
      ).bind(limit, offset).all();
      return json({ items: results, limit, offset }, 200, 60);
    }
    return json({ error: "not_found" }, 404);
  },

  async scheduled(_event: unknown, env: any, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(ingestAll(env));
  },
};

async function ingestAll(env: any) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM sources WHERE enabled = 1
     AND (last_success_at IS NULL OR datetime(last_success_at, '+' || poll_interval_min || ' minutes') <= datetime('now'))`
  ).all();
  for (const s of results) await ingestSource(env, s);
}

async function ingestSource(env: any, s: any) {
  try {
    const headers: Record<string, string> = { "user-agent": "HackerNewsArBot/0.1 (+https://hackernews.com.ar)" };
    if (s.etag) headers["if-none-match"] = s.etag;
    if (s.last_modified) headers["if-modified-since"] = s.last_modified;
    const res = await fetch(s.feed_url, { headers });
    if (res.status !== 304) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      const items = parseFeed(await res.text()).slice(0, 50);
      const stmts = items.map((i) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO articles(source_id, canonical_url, guid, original_title, original_excerpt, published_at, original_lang)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(s.id, i.url, i.guid, i.title, i.excerpt, i.publishedAt, s.language)
      );
      if (stmts.length) await env.DB.batch(stmts);
    }
    await env.DB.prepare(
      `UPDATE sources SET etag = ?1, last_modified = ?2, last_success_at = datetime('now'), last_error = NULL, consecutive_failures = 0 WHERE id = ?3`
    ).bind(null, null, s.id).run();
  } catch (e: any) {
    await env.DB.prepare(
      `UPDATE sources SET last_error = ?1, consecutive_failures = consecutive_failures + 1 WHERE id = ?2`
    ).bind(String(e?.message || e).slice(0, 300), s.id).run();
  }
}
