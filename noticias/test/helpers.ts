import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function d1(db: DatabaseSync) {
  const mk = (sql: string) => {
    let p: any[] = [];
    const st: any = {
      _sql: sql, _p: () => p, bind: (...a: any[]) => { p = a; return st; },
      all: async () => ({ results: db.prepare(sql).all(...p) }),
      first: async () => db.prepare(sql).get(...p) ?? null,
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...p).changes) } }),
    };
    return st;
  };
  return { prepare: mk, batch: async (sts: any[]) => sts.map((s) => /returning/i.test(s._sql)
    ? { results: db.prepare(s._sql).all(...s._p()) }
    : { results: [], meta: { changes: Number(db.prepare(s._sql).run(...s._p()).changes) } }) };
}
export function kv() { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } }; }
export function setup(extra: Record<string, any> = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init", "0002_seed_sources", "0003_ingest_runs", "0004_actors_mitre", "0005_source_verification"]) db.exec(readFileSync(`migrations/${f}.sql`, "utf8"));
  const env: any = { DB: d1(db), CACHE: kv(), ...extra };
  return { db, env };
}
export const ctx = { waitUntil() {} };
