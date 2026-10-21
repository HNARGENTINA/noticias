# HackerNews.com.ar — noticias

Plataforma de inteligencia de ciberamenazas en español, sobre Cloudflare Workers + D1 + KV.

## Estado real (honesto)
| Parte | Estado |
|---|---|
| Página (`public/index.html`) | Demo visual. Todo su contenido está marcado SIMULADO. No usa datos reales. |
| `GET /api/health`, `GET /api/articles` | Implementados, leen D1. Sin verificar en producción. |
| Ingesta RSS/Atom por cron (cada 30 min) | Implementada. Parser con 3 tests pasando. **No probada contra feeds reales.** |
| Traducción/resumen, NVD, ATT&CK, imágenes | Pendientes. Los artículos quedan con `translation_status = pending`. |
| R2 (imágenes generadas) | Bloqueado: hay que activar R2 en el panel de Cloudflare. |

## Cómo subirlo
1. En GitHub, repo `HNARGENTINA/noticias` → **Add file → Upload files** → arrastra TODO el contenido de esta carpeta (incluye `public/`, `src/`, `migrations/`, `test/`) → **Commit**.
2. Cloudflare despliega solo (Workers Builds, Worker `noticias`). Si no, en Cloudflare: Workers → `noticias` → Settings → Builds → conectar el repo, rama `main`, deploy command `npx wrangler deploy`.
3. Migración 0002 (fuentes iniciales): si no se aplicó, ejecútala en D1 `hn-argentina` desde la consola de Cloudflare.
4. Dominio: Worker `noticias` → Settings → Domains → agregar `hackernews.com.ar`.

## Desarrollo local
```
npm install
npm test
npx wrangler dev
```
Claves (por ejemplo NVD) van en `.dev.vars` local o como Secrets del Worker. Nunca en el repo.
