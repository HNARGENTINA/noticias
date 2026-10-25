ALTER TABLE sources ADD COLUMN adapter TEXT NOT NULL DEFAULT 'rss';
ALTER TABLE articles ADD COLUMN translation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN translation_provider TEXT;
CREATE INDEX IF NOT EXISTS idx_articles_hash ON articles(content_hash);
CREATE TABLE IF NOT EXISTS ingest_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL REFERENCES sources(id), adapter TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, fetched INTEGER NOT NULL DEFAULT 0, inserted INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK (status IN ('ok','not_modified','error')), error TEXT);
CREATE INDEX IF NOT EXISTS idx_runs_src ON ingest_runs(source_id, id DESC);
INSERT OR IGNORE INTO sources(slug,name,url,feed_url,language,source_type,reliability,poll_interval_min,adapter) VALUES
('cisa-kev','CISA Known Exploited Vulnerabilities','https://www.cisa.gov/known-exploited-vulnerabilities-catalog','https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json','en','agency','high',60,'kev'),
('nvd','NVD (NIST) CVE API 2.0','https://nvd.nist.gov/developers/vulnerabilities','https://services.nvd.nist.gov/rest/json/cves/2.0','en','agency','high',30,'nvd'),
('securelist','Securelist (Kaspersky)','https://securelist.com','https://securelist.com/feed/','en','research','high',120,'rss'),
('microsoft-security','Microsoft Security Blog','https://www.microsoft.com/en-us/security/blog/','https://www.microsoft.com/en-us/security/blog/feed/','en','vendor','high',120,'rss');
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0003_ingest_runs');
