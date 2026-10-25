import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, safeUrl } from "../src/feed.ts";

const rss = `<rss><channel><item><title><![CDATA[Falla crítica en <b>X</b> &amp; Y]]></title>
<link>https://ejemplo.test/a?utm_source=tw&id=1#frag</link><guid>g1</guid>
<pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><description>Resumen &lt;ok&gt;</description></item>
<item><title>Peligroso</title><link>javascript:alert(1)</link></item></channel></rss>`;
const atom = `<feed><entry><title>Atom uno</title><link rel="alternate" href="https://ejemplo.test/b"/><id>urn:b</id><updated>2026-10-11T08:00:00Z</updated><summary>S</summary></entry></feed>`;

test("RSS: limpia, quita tracking y descarta enlaces no http(s)", () => {
  const r = parseFeed(rss);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, "https://ejemplo.test/a?id=1");
  assert.equal(r[0].title, "Falla crítica en X & Y");
  assert.equal(r[0].publishedAt, "2026-10-12T10:00:00.000Z");
});
test("Atom: lee href, id y fecha", () => {
  const r = parseFeed(atom);
  assert.equal(r[0].url, "https://ejemplo.test/b");
  assert.equal(r[0].guid, "urn:b");
  assert.equal(r[0].publishedAt, "2026-10-11T08:00:00.000Z");
});
test("safeUrl rechaza esquemas peligrosos", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("no es url"), null);
});
