export type FeedItem = { url: string; guid: string; title: string; excerpt: string; publishedAt: string | null };

function clean(s: string): string {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? clean(m[1]) : "";
}

export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch { return null; }
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  const out: FeedItem[] = [];
  for (const b of blocks) {
    let link = tag(b, "link");
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ""; }
    const url = safeUrl(link);
    const title = tag(b, "title");
    if (!url || !title) continue;
    const d = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const t = d ? new Date(d) : null;
    out.push({
      url, title: title.slice(0, 300),
      guid: tag(b, "guid") || tag(b, "id") || url,
      excerpt: (tag(b, "description") || tag(b, "summary")).slice(0, 500),
      publishedAt: t && !isNaN(t.getTime()) ? t.toISOString() : null,
    });
  }
  return out;
}
