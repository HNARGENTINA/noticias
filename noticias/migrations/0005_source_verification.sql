ALTER TABLE sources ADD COLUMN verified_at TEXT;
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0005_source_verification');
