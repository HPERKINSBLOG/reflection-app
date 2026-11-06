-- Quiesced migration: deploy matching writers after successful completion.
-- Preserve cascading revisit rows and exact encrypted bytes before rebuilding parents.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER storage_accounts_insert;
DROP TRIGGER storage_basis_snapshots_insert;
DROP TRIGGER storage_basis_snapshots_update;
DROP TRIGGER storage_basis_snapshots_delete;
DROP TRIGGER storage_reading_editions_insert;
DROP TRIGGER storage_reading_editions_update;
DROP TRIGGER storage_reading_editions_delete;
DROP TRIGGER storage_revisits_insert;
DROP TRIGGER storage_revisits_update;
DROP TRIGGER storage_revisits_delete;
DROP TRIGGER storage_revisit_revisions_insert;
DROP TRIGGER storage_revisit_revisions_update;
DROP TRIGGER storage_revisit_revisions_delete;
DROP TRIGGER storage_deletion_jobs_insert;
DROP TRIGGER storage_deletion_jobs_update;
DROP TRIGGER storage_deletion_jobs_delete;
CREATE TABLE astrology_revisits_backup AS SELECT * FROM revisits;
CREATE TABLE astrology_revisit_revisions_backup AS SELECT * FROM revisit_revisions;
CREATE TABLE pattern_content_releases (
 hash TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL CHECK(state IN('active','withdrawn')),
 release_json TEXT NOT NULL, created_at INTEGER NOT NULL, withdrawn_at INTEGER,
 CHECK((state='withdrawn')=(withdrawn_at IS NOT NULL))
);
CREATE TABLE pattern_state (
 id INTEGER PRIMARY KEY NOT NULL CHECK(id=1), content_hash TEXT NOT NULL REFERENCES pattern_content_releases(hash),
 revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 calculation_hash TEXT NOT NULL, updated_at INTEGER NOT NULL
);
ALTER TABLE reading_sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'tarot' CHECK(method IN('tarot','astrology','imported'));
UPDATE reading_sessions SET method='imported' WHERE EXISTS(SELECT 1 FROM reading_editions e WHERE e.owner_id=reading_sessions.owner_id AND e.session_id=reading_sessions.id AND e.mode='legacy') AND NOT EXISTS(SELECT 1 FROM reading_editions e WHERE e.owner_id=reading_sessions.owner_id AND e.session_id=reading_sessions.id AND e.mode IN('model','template'));
CREATE UNIQUE INDEX reading_session_method_identity ON reading_sessions(owner_id,id,method);
CREATE INDEX reading_sessions_method_history ON reading_sessions(owner_id,status,method,created_at DESC,id DESC);
CREATE TABLE birth_profiles (
 owner_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>0), body_enc TEXT,
 key_version INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version),
 CHECK((body_enc IS NULL)=(deleted_at IS NOT NULL)), CHECK((body_enc IS NULL)=(key_version IS NULL))
);
CREATE TABLE astrology_admissions (
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 quota_day TEXT NOT NULL, input_hmac TEXT NOT NULL, key_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,quota_day,input_hmac), FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version),
 CHECK(expires_at>created_at)
);
CREATE INDEX astrology_admission_expiry ON astrology_admissions(expires_at);
CREATE TABLE pattern_saved_sources (
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, source_hmac TEXT NOT NULL,
 session_id TEXT NOT NULL, edition_id TEXT NOT NULL, key_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
 edition_mode TEXT GENERATED ALWAYS AS ('pattern') VIRTUAL,
 PRIMARY KEY(owner_id,source_hmac), UNIQUE(owner_id,session_id), UNIQUE(owner_id,edition_id),
 FOREIGN KEY(owner_id,session_id) REFERENCES reading_sessions(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,edition_id,session_id,edition_mode) REFERENCES reading_editions(owner_id,id,session_id,mode),
 FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version)
);
CREATE TABLE basis_snapshots_next (
  session_method TEXT GENERATED ALWAYS AS (CASE WHEN kind='astrology.natal.v2' THEN 'astrology' ELSE NULL END) VIRTUAL,
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('tarot.v1','astrology.natal.v2')), schema_version INTEGER NOT NULL CHECK((kind='tarot.v1' AND schema_version=1) OR (kind='astrology.natal.v2' AND schema_version=2)),
  body_enc TEXT, key_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(owner_id,id), UNIQUE(owner_id,id,session_id), UNIQUE(owner_id,session_id),
  FOREIGN KEY(owner_id,session_id) REFERENCES reading_sessions(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version),
  FOREIGN KEY(owner_id,session_id,session_method) REFERENCES reading_sessions(owner_id,id,method)
);
INSERT INTO basis_snapshots_next SELECT * FROM basis_snapshots;
DROP TABLE basis_snapshots;
ALTER TABLE basis_snapshots_next RENAME TO basis_snapshots;
CREATE UNIQUE INDEX basis_method_identity ON basis_snapshots(owner_id,id,session_id,kind);
CREATE TABLE reading_editions_next (
  basis_kind TEXT GENERATED ALWAYS AS (CASE WHEN mode='pattern' THEN 'astrology.natal.v2' WHEN mode IN('model','template') THEN 'tarot.v1' ELSE NULL END) VIRTUAL,
  session_method TEXT GENERATED ALWAYS AS (CASE WHEN mode='pattern' THEN 'astrology' WHEN mode IN('model','template') THEN 'tarot' ELSE NULL END) VIRTUAL,
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, session_id TEXT NOT NULL, edition_number INTEGER NOT NULL CHECK(edition_number>0),
  request_id TEXT UNIQUE, basis_id TEXT, parent_edition_id TEXT,
  status TEXT NOT NULL CHECK(status IN('accepted','imported','withdrawn','deleted')),
  mode TEXT NOT NULL CHECK(mode IN('model','template','legacy','pattern')),
  body_enc TEXT, key_version INTEGER NOT NULL, content_hash TEXT REFERENCES content_editions(hash),
  pattern_content_hash TEXT REFERENCES pattern_content_releases(hash),
  accepted_at INTEGER NOT NULL, invalidated_at INTEGER,
  UNIQUE(owner_id,id), UNIQUE(owner_id,session_id,edition_number),
  FOREIGN KEY(owner_id,session_id) REFERENCES reading_sessions(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,request_id) REFERENCES generation_requests(owner_id,id),
  FOREIGN KEY(owner_id,basis_id,session_id) REFERENCES basis_snapshots(owner_id,id,session_id),
  FOREIGN KEY(owner_id,parent_edition_id) REFERENCES reading_editions(owner_id,id),
  FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version),
  CHECK(status IN('withdrawn','deleted') OR body_enc IS NOT NULL),
  CHECK((status IN('withdrawn','deleted'))=(invalidated_at IS NOT NULL)),
  CHECK((mode='legacy' AND request_id IS NULL AND pattern_content_hash IS NULL) OR (mode IN('model','template') AND request_id IS NOT NULL AND basis_id IS NOT NULL AND content_hash IS NOT NULL AND pattern_content_hash IS NULL) OR (mode='pattern' AND request_id IS NULL AND basis_id IS NOT NULL AND pattern_content_hash IS NOT NULL AND content_hash IS NULL AND parent_edition_id IS NULL AND status!='imported')),
  FOREIGN KEY(owner_id,basis_id,session_id,basis_kind) REFERENCES basis_snapshots(owner_id,id,session_id,kind),
  FOREIGN KEY(owner_id,session_id,session_method) REFERENCES reading_sessions(owner_id,id,method)
);
INSERT INTO reading_editions_next(id,owner_id,session_id,edition_number,request_id,basis_id,parent_edition_id,status,mode,body_enc,key_version,content_hash,accepted_at,invalidated_at) SELECT id,owner_id,session_id,edition_number,request_id,basis_id,parent_edition_id,status,mode,body_enc,key_version,content_hash,accepted_at,invalidated_at FROM reading_editions;
DROP TABLE reading_editions;
ALTER TABLE reading_editions_next RENAME TO reading_editions;
CREATE INDEX editions_session ON reading_editions(owner_id,session_id,edition_number);
CREATE UNIQUE INDEX reading_edition_session_identity ON reading_editions(owner_id,id,session_id);
CREATE UNIQUE INDEX reading_edition_method_identity ON reading_editions(owner_id,id,session_id,mode);
INSERT INTO revisits SELECT * FROM astrology_revisits_backup;
INSERT INTO revisit_revisions SELECT * FROM astrology_revisit_revisions_backup;
DROP TABLE astrology_revisits_backup;
DROP TABLE astrology_revisit_revisions_backup;
CREATE TABLE deletion_jobs_next (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK(scope IN('account','session','reflection_revision','context_copy','revisit','birth_profile')),
  target_hmac TEXT NOT NULL, target_enc TEXT, receipt_token_hash TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN('fencing','ledger_pending','erasing','complete')),
  ledger_key TEXT NOT NULL UNIQUE, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_run_at INTEGER NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER, backup_expires_by INTEGER
);
INSERT INTO deletion_jobs_next SELECT * FROM deletion_jobs;
DROP TABLE deletion_jobs;
ALTER TABLE deletion_jobs_next RENAME TO deletion_jobs;
CREATE INDEX deletion_due ON deletion_jobs(state,next_run_at);
CREATE TRIGGER basis_kind_immutable BEFORE UPDATE OF kind,schema_version,owner_id,session_id ON basis_snapshots WHEN NEW.kind!=OLD.kind OR NEW.schema_version!=OLD.schema_version OR NEW.owner_id!=OLD.owner_id OR NEW.session_id!=OLD.session_id BEGIN
 SELECT RAISE(ABORT,'Basis identity is immutable');
END;
CREATE TRIGGER session_method_immutable BEFORE UPDATE OF method ON reading_sessions WHEN NEW.method!=OLD.method AND EXISTS(SELECT 1 FROM basis_snapshots b WHERE b.owner_id=OLD.owner_id AND b.session_id=OLD.id) BEGIN
 SELECT RAISE(ABORT,'Session method with a basis is immutable');
END;
CREATE TRIGGER generation_tarot_method_insert BEFORE INSERT ON generation_requests WHEN EXISTS(SELECT 1 FROM reading_sessions s WHERE s.owner_id=NEW.owner_id AND s.id=NEW.session_id AND s.method='astrology') OR EXISTS(SELECT 1 FROM basis_snapshots b WHERE b.owner_id=NEW.owner_id AND b.id=NEW.basis_id AND b.kind!='tarot.v1') OR EXISTS(SELECT 1 FROM reading_editions e WHERE e.owner_id=NEW.owner_id AND e.id=NEW.parent_edition_id AND e.mode='pattern') BEGIN SELECT RAISE(ABORT,'Generation requires a tarot family'); END;
CREATE TRIGGER generation_tarot_method_update BEFORE UPDATE ON generation_requests WHEN EXISTS(SELECT 1 FROM reading_sessions s WHERE s.owner_id=NEW.owner_id AND s.id=NEW.session_id AND s.method='astrology') OR EXISTS(SELECT 1 FROM basis_snapshots b WHERE b.owner_id=NEW.owner_id AND b.id=NEW.basis_id AND b.kind!='tarot.v1') OR EXISTS(SELECT 1 FROM reading_editions e WHERE e.owner_id=NEW.owner_id AND e.id=NEW.parent_edition_id AND e.mode='pattern') BEGIN SELECT RAISE(ABORT,'Generation requires a tarot family'); END;
CREATE TRIGGER storage_basis_snapshots_insert AFTER INSERT ON "basis_snapshots" BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_basis_snapshots_update AFTER UPDATE OF "owner_id","body_enc" ON "basis_snapshots" BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
  UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_basis_snapshots_delete AFTER DELETE ON "basis_snapshots" BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_reading_editions_insert AFTER INSERT ON "reading_editions" BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_reading_editions_update AFTER UPDATE OF "owner_id","body_enc" ON "reading_editions" BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
  UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_reading_editions_delete AFTER DELETE ON "reading_editions" BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_revisits_insert AFTER INSERT ON "revisits" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."note_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_revisits_update AFTER UPDATE ON "revisits" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."note_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."note_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_revisits_delete AFTER DELETE ON "revisits" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."note_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_revisit_revisions_insert AFTER INSERT ON "revisit_revisions" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_revisit_revisions_update AFTER UPDATE ON "revisit_revisions" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_revisit_revisions_delete AFTER DELETE ON "revisit_revisions" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_deletion_jobs_insert AFTER INSERT ON "deletion_jobs" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."target_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_deletion_jobs_update AFTER UPDATE ON "deletion_jobs" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."target_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."target_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_deletion_jobs_delete AFTER DELETE ON "deletion_jobs" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."target_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_birth_profiles_insert AFTER INSERT ON birth_profiles BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_birth_profiles_delete AFTER DELETE ON birth_profiles BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_birth_profiles_update AFTER UPDATE ON birth_profiles BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_astrology_admissions_insert AFTER INSERT ON astrology_admissions BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_astrology_admissions_delete AFTER DELETE ON astrology_admissions BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_astrology_admissions_update AFTER UPDATE ON astrology_admissions BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_pattern_saved_sources_insert AFTER INSERT ON pattern_saved_sources BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_pattern_saved_sources_delete AFTER DELETE ON pattern_saved_sources BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_pattern_saved_sources_update AFTER UPDATE ON pattern_saved_sources BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_accounts_insert AFTER INSERT ON accounts BEGIN
 UPDATE accounts SET storage_bytes=1024+
 coalesce((SELECT sum(1024+coalesce(length(CAST(birth_profiles."body_enc" AS BLOB)),0)) FROM "birth_profiles" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "astrology_admissions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "pattern_saved_sources" WHERE owner_id=NEW.id),0)+

 coalesce((SELECT sum(1024+coalesce(length(CAST(account_keys."wrapped_key_enc" AS BLOB)),0)+coalesce(length(CAST(account_keys."wrapped_index_key_enc" AS BLOB)),0)) FROM "account_keys" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "account_rekey_entries" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "account_rekey_jobs" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "auth_challenges" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "auth_sessions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(basis_snapshots."body_enc" AS BLOB)),0)) FROM "basis_snapshots" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "context_grants" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "cost_reservations" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "credentials" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(deletion_jobs."target_enc" AS BLOB)),0)) FROM "deletion_jobs" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "export_tickets" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "generation_attempts" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(generation_context."fragment_enc" AS BLOB)),0)) FROM "generation_context" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(generation_requests."input_enc" AS BLOB)),0)+coalesce(length(CAST(generation_requests."plan_enc" AS BLOB)),0)) FROM "generation_requests" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "idempotency_keys" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "import_batches" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(import_identities."source_record_enc" AS BLOB)),0)) FROM "import_identities" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(import_items."body_enc" AS BLOB)),0)+coalesce(length(CAST(import_items."result_enc" AS BLOB)),0)) FROM "import_items" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "key_retirement_operations" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "permission_revisions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(provider_dispatches."provider_response_id_enc" AS BLOB)),0)+coalesce(length(CAST(provider_dispatches."transmission_enc" AS BLOB)),0)+coalesce(length(CAST(provider_dispatches."candidate_enc" AS BLOB)),0)) FROM "provider_dispatches" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "quota_buckets" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "quota_events" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "quota_reservations" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(reading_editions."body_enc" AS BLOB)),0)) FROM "reading_editions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(reading_sessions."question_enc" AS BLOB)),0)) FROM "reading_sessions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "recovery_codes" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(reflection_revisions."body_enc" AS BLOB)),0)) FROM "reflection_revisions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "reflections" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "request_events" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(revisit_revisions."body_enc" AS BLOB)),0)) FROM "revisit_revisions" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(revisits."note_enc" AS BLOB)),0)) FROM "revisits" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(security_operations."snapshot_enc" AS BLOB)),0)) FROM "security_operations" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "import_groups" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024+coalesce(length(CAST(import_staging."field_enc" AS BLOB)),0)) FROM "import_staging" WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM "import_copy_sources" WHERE owner_id=NEW.id),0)+
 1024*(SELECT count(*) FROM cost_adjustments a JOIN cost_reservations c ON c.id=a.cost_id WHERE c.owner_id=NEW.id) WHERE id=NEW.id;
END;
CREATE TABLE astrology_migration_integrity(violations INTEGER NOT NULL CHECK(violations=0));
INSERT INTO astrology_migration_integrity SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE astrology_migration_integrity;
PRAGMA defer_foreign_keys=OFF;
