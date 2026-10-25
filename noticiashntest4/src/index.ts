import { handle } from "./api.ts";
import { ingestAll, type Group } from "./ingest.ts";

// Un Cron Trigger por grupo (el plan gratuito permite 5 por cuenta).
const CRON_GROUPS: Record<string, Group> = {
  "0,30 * * * *": "rss0",
  "15,45 * * * *": "rss1",
  "20 * * * *": "kev",
  "5,35 * * * *": "nvd",
  "10,40 * * * *": "translate",
};

export default {
  async fetch(req: Request, env: any, ctx: any): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (e: any) {
      console.error("error_interno", e?.message || e);
      return new Response(JSON.stringify({ error: "error_interno" }), { status: 500, headers: { "content-type": "application/json" } });
    }
  },
  async scheduled(event: { cron: string }, env: any, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(ingestAll(env, false, CRON_GROUPS[event.cron] ?? "all"));
  },
};
