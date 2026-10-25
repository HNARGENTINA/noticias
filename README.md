# HackerNews.com.ar — «Más allá de la noticia.»

Medio de ciberseguridad y tecnología en español sobre Cloudflare Workers + D1 + Workers AI. Sin datos de relleno: sin registros, la web muestra estados vacíos.

**Slogan elegido:** «Más allá de la noticia.» (posicionamiento híbrido: tecnología, actualidad y ciberseguridad). El diferencial técnico se expresa en el contenido —CVE, ATT&CK, evidencia— y no en el eslogan, que no limita al medio a un nicho.

## Estado verificado
| Parte | Estado |
|---|---|
| D1 `hn-argentina` | Migraciones 0001–0005 aplicadas en producción; 7 fuentes y 5 grupos MITRE cargados. **0 artículos y 0 ejecuciones**: el código nuevo aún no está desplegado. |
| Pipeline, admin, SEO, búsqueda, crons | **16 pruebas pasan** (SQLite con las migraciones reales + respuestas simuladas). |
| Feeds reales, D1/Workers AI reales, despliegue público | **No verificado.** Se comprueba tras desplegar. |
| Vista móvil en navegador real | **No realizada** (sin navegador en el entorno de desarrollo). |
| Límite de CPU gratuito (10 ms por ejecución) | **Riesgo no medido**, sobre todo en KEV (JSON grande). Ver «Plan gratuito». |

## Qué hace
- **Ingesta** por Cron Triggers divididos (el plan gratuito permite 5 y 10 ms de CPU por ejecución):
  `rss0` (:00/:30), `rss1` (:15/:45), `nvd` (:05/:35), `translate` (:10/:40), `kev` (:20). Los RSS se reparten por `id % 2`, así una fuente nueva entra sola en uno de los dos tramos.
- **Deduplicación** por URL canónica (sin utm) y por hash del título normalizado. **Registro** de cada ejecución en `ingest_runs`.
- **Traducción** del extracto con Workers AI (hasta 5 artículos por ejecución; 3 intentos). Sin IA, los artículos quedan en borrador con el texto original, rotulados.
- **Páginas reales de artículo** (`/noticias/ID-slug`) renderizadas en el servidor: canonical, Open Graph, JSON-LD `NewsArticle` (autor = organización de la fuente, `isBasedOn` = URL original), escape de todo texto externo y redirección 301 si el slug cambia. Los borradores sin traducir llevan `noindex` y no entran al sitemap.
- `/sitemap.xml` y `/robots.txt` dinámicos. Define `SITE_URL` (variable) cuando el dominio definitivo esté conectado; si no, usa el host de la petición.
- **Búsqueda y filtros** (`q`, `cat`, `source`) y **destacado transparente** (`/api/featured`): fiabilidad de la fuente (+2/+1), CVE mencionada (+1), grupo ATT&CK mencionado (+1), últimas 72 h; sin selección manual.

## Administración (protegida con `ADMIN_TOKEN`; 5 fallos bloquean la IP 10 min vía KV)
```
GET   /api/admin/sources
POST  /api/admin/sources              {slug,name,url,feed_url,language,source_type[,reliability,poll_interval_min]}  (nace deshabilitada)
POST  /api/admin/sources/ID/test      lee el feed sin guardar nada; si es válido la marca verificada
PATCH /api/admin/sources/ID           {enabled,name,feed_url,poll_interval_min,...}  (activar exige verificación previa)
POST  /api/admin/ingest?group=all|rss0|rss1|kev|nvd|translate
```
Solo URLs `https` públicas (se rechazan localhost, IP numéricas y credenciales en la URL). Cambiar `feed_url` invalida la verificación.

## Desplegar
1. Subí el contenido de esta carpeta a `HNARGENTINA/noticias` (rama `main`); Cloudflare despliega (Worker `noticias`).
2. Secretos: `ADMIN_TOKEN` (obligatorio para administrar) y opcional `NVD_API_KEY`.
3. Primera ingesta **un grupo por vez** (en el plan gratuito, `all` probablemente exceda 10 ms):
   `curl -X POST "https://TU-URL/api/admin/ingest?group=rss0" -H "Authorization: Bearer TU_TOKEN"` y repetí con `rss1`, `nvd`, `kev`, `translate`.
4. Revisá `/api/status` (o la pestaña Estado) y *Workers → noticias → Metrics → Errors → «Exceeded CPU Time Limits»*.

## Plan gratuito: qué puede fallar
- 10 ms de CPU por ejecución de cron: el procesamiento del JSON de KEV (>1 MB) podría excederlo. Si ocurre: Workers Paid (5 USD/mes) o mover KEV a una GitHub Action programada (gratis).
- 50 subrequests por ejecución: cada grupo está dimensionado para no superarlos.
- Workers AI: 10.000 neuronas/día; la traducción es lo primero que se limitaría.
- Fuentes en español (`language: "es"`) no consumen traducción.
- R2 (imágenes generadas) no está activado; no es necesario para la ingesta.

## Pendiente
Técnicas ATT&CK por grupo (sincronización STIX), fichas individuales de CVE y de actores como páginas SEO, tracker de ransomware, imágenes generadas, resumen editorial con IA más allá de la traducción del extracto.

## Desarrollo
```
npm install && npm test && npx wrangler dev
```
