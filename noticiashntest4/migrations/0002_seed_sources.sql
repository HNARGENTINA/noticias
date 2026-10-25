-- Fuentes iniciales. Las URLs de feed NO fueron verificadas en vivo desde el entorno de desarrollo:
-- revisa /api/health tras la primera ejecucion del cron (last_error por fuente).
INSERT OR IGNORE INTO sources(slug,name,url,feed_url,language,source_type,reliability,poll_interval_min) VALUES
('cisa-advisories','CISA Cybersecurity Advisories','https://www.cisa.gov/news-events/cybersecurity-advisories','https://www.cisa.gov/cybersecurity-advisories/all.xml','en','agency','high',60),
('thehackernews','The Hacker News','https://thehackernews.com','https://feeds.feedburner.com/TheHackersNews','en','publication','medium',30),
('bleepingcomputer','BleepingComputer','https://www.bleepingcomputer.com','https://www.bleepingcomputer.com/feed/','en','publication','medium',30);
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0002_seed_sources');
