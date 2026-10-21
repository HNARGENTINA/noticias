# HackerNews.com.ar — noticias

Newspaper de ciberinteligencia en español sobre Cloudflare Workers + D1 + Workers AI. Sin datos de relleno: si no hay registros, la web muestra un estado vacío.

## Estado verificado (qué está probado y qué no)

| Parte | Estado |
|---|---|
| Base D1 `hn-argentina` | **Migraciones 0001–0004 aplicadas en producción** (7 fuentes, 5 grupos MITRE). Verificado. |
| Pipeline (RSS, KEV, NVD, dedupe, traducción, enriquecimiento, registro de ejecuciones) | **11 pruebas pasan** con las migraciones reales sobre SQLite y respuestas simuladas. |
| Ejecución contra feeds reales y contra D1/Workers AI reales | **NO verificada.** Se comprueba tras desplegar (ver abajo). |
| Despliegue público | **NO verificado desde acá** (no hay herramienta de GitHub/deploy en este chat). |
| Prueba visual en móvil | **NO realizada** (sin navegador en el entorno). La nav usa una grilla de 4 columnas ≤720 px; revisala en tu teléfono. |
| Técnicas ATT&CK por grupo, sincronización STIX | Pendiente. Los perfiles muestran ID, alias (APT28) y descripción; las técnicas figuran como pendientes. |
| Tracker de ransomware, imágenes generadas (R2), ATT&CK por incidente | Pendiente. R2 requiere activarse en el panel de Cloudflare. |

## Fuentes configuradas
CISA KEV (JSON oficial), NVD API 2.0, CISA Advisories (RSS), The Hacker News, BleepingComputer, Securelist, Microsoft Security Blog.
Las URLs no se pudieron abrir desde el entorno de desarrollo: la primera ejecución real dirá cuáles responden (pestaña **Estado** o `/api/status`).

## Desplegar
1. En GitHub subí/reemplazá todo el contenido de esta carpeta en `HNARGENTINA/noticias` (rama `main`). Cloudflare despliega solo (Worker `noticias`).
2. Secretos (Cloudflare → Workers → noticias → Settings → Variables and Secrets): `ADMIN_TOKEN` (cualquier cadena larga) y, opcional, `NVD_API_KEY`.
3. Forzar la primera ingesta sin esperar al cron:
   `curl -X POST https://TU-WORKER.workers.dev/api/admin/ingest -H "Authorization: Bearer TU_ADMIN_TOKEN"`
4. Verificá en `/api/status` (o la pestaña Estado): fuentes con `ok`, artículos nuevos, errores por fuente.

## Notas de diseño
- Mención de un grupo en una noticia = evidencia `reported`, nunca atribución.
- Los artículos sin traducción quedan en borrador y se muestran con el texto original, rotulados.
- Traducción: Workers AI `@cf/meta/m2m100-1.2b` (hasta 5 artículos por ejecución, 3 intentos). Es traducción automática del extracto, no un resumen editorial.
- KEV se carga de forma gradual (400 registros por ejecución) para respetar los límites de subrequests de Workers.
- Si NVD devuelve más de 500 CVE en una ventana, el recorte queda registrado como aviso en la ejecución.

## Desarrollo
```
npm install
npm test
npx wrangler dev
```
