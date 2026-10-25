import { esc, iso } from "./util.ts";

export const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cache-control": "public, max-age=300",
};

export function slugify(t: string): string {
  return (t || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 70).replace(/^-+|-+$/g, "") || "noticia";
}
export const articleUrl = (a: { id: number; title_es?: string | null; original_title: string }) => `/noticias/${a.id}-${slugify(a.title_es || a.original_title)}`;
export const isIndexable = (a: any) => a.translation_status === "done" || a.translation_status === "skipped";

function shell(o: { title: string; desc: string; canonical?: string; noindex?: boolean; ld?: unknown; body: string }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}">${o.noindex ? '<meta name="robots" content="noindex, follow">' : ""}
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}"><meta property="og:url" content="${esc(o.canonical)}">` : ""}
<meta property="og:site_name" content="HackerNews.com.ar"><meta property="og:type" content="article"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.desc)}"><meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/style.css">${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, "\\u003c")}</script>` : ""}</head><body>
<header><div class="wrap bar"><a class="logo" href="/">HACKERNEWS<i>.com.ar</i></a><nav aria-label="Principal"><a href="/">Portada</a><a href="/#/inteligencia">Inteligencia</a><a href="/#/actores">Actores</a><a href="/#/estado">Estado</a></nav></div></header>
<main class="wrap">${o.body}</main><footer><div class="wrap">HACKERNEWS.COM.AR · Más allá de la noticia. Resúmenes de fuentes públicas con enlace al original; mencionar a un grupo en una noticia no es una atribución.</div></footer></body></html>`;
}

export function articlePage(a: any, cats: string[], ents: any[], related: any[], origin: string): string {
  const title = a.title_es || a.original_title;
  const desc = (a.summary_es || a.original_excerpt || title).slice(0, 155);
  const canonical = origin + articleUrl(a);
  const ld = {
    "@context": "https://schema.org", "@type": "NewsArticle", headline: title.slice(0, 110), description: desc, inLanguage: "es",
    datePublished: iso(a.published_at) || iso(a.ingested_at), dateModified: iso(a.updated_at) || iso(a.ingested_at),
    mainEntityOfPage: canonical, isBasedOn: a.canonical_url,
    author: { "@type": "Organization", name: a.source_name, url: a.source_url }, publisher: { "@type": "Organization", name: "HackerNews.com.ar" },
  };
  const cves = ents.filter((e) => e.entity_type === "cve"), act = ents.filter((e) => e.entity_type === "actor");
  const note = a.translation_status === "done" ? `Traducción automática del extracto de la fuente (${esc(a.translation_provider)}). Puede contener imprecisiones.` : a.translation_status === "skipped" ? "Fuente en español." : "Pendiente de traducción; se muestra el texto original.";
  const body = `<article class="art"><a class="mono" style="color:var(--ac)" href="/">← PORTADA</a>
<div class="meta" style="margin-top:18px">${cats.map((c) => `<span class="tag">${esc(c)}</span>`).join("")}</div><h1>${esc(title)}</h1>
<div class="meta"><span>Fuente: ${esc(a.source_name)}</span><time datetime="${esc(iso(a.published_at) || "")}">Publicado: ${esc((iso(a.published_at) || "—").slice(0, 10))}</time><span>Ingerido: ${esc((iso(a.ingested_at) || "—").slice(0, 16).replace("T", " "))} UTC</span></div>
<h3>Resumen</h3><p>${esc(a.summary_es || a.original_excerpt || "Sin extracto disponible.")}</p><p class="mono" style="font-size:12px;color:var(--mut)">${note}</p>
<h3>Fuente original</h3><p><a style="color:var(--ac)" rel="noopener noreferrer" href="${esc(a.canonical_url)}">${esc(a.canonical_url)} →</a></p>
${cves.length ? `<h3>CVE mencionadas</h3><p>${cves.map((c) => `<a class="tag" rel="noopener noreferrer" href="https://nvd.nist.gov/vuln/detail/${esc(c.entity_id)}">${esc(c.entity_id)}</a>`).join(" ")}</p>` : ""}
${act.length ? `<h3>Grupos mencionados</h3><p>${act.map((c) => `<a class="tag" rel="noopener noreferrer" href="${esc(c.actor_url)}">${esc(c.actor_name)} · ${esc(c.entity_id)}</a>`).join(" ")}</p><p class="mono" style="font-size:12px;color:var(--mut)">Los nombres aparecen en el texto de la fuente. Esto no confirma una atribución.</p>` : ""}
${related.length ? `<h3>Relacionadas</h3><ul>${related.map((r) => `<li><a href="${esc(articleUrl(r))}">${esc(r.title_es || r.original_title)}</a></li>`).join("")}</ul>` : ""}</article>`;
  return shell({ title: `${title} — HackerNews.com.ar`, desc, canonical, noindex: !isIndexable(a), ld: isIndexable(a) ? ld : undefined, body });
}

export const notFoundPage = () => shell({ title: "No encontrado — HackerNews.com.ar", desc: "La página solicitada no existe.", noindex: true, body: `<div class="panel p" style="margin-top:40px">No encontramos esa noticia. <a style="color:var(--ac)" href="/">Volver a la portada</a></div>` });

export const robotsTxt = (origin: string) => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
export function sitemapXml(origin: string, rows: any[]): string {
  const u = (loc: string, last?: string | null) => `<url><loc>${esc(origin + loc)}</loc>${last ? `<lastmod>${esc(last)}</lastmod>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u("/")}${rows.map((r) => u(articleUrl(r), iso(r.updated_at) || iso(r.ingested_at))).join("")}</urlset>`;
}
