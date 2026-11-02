-- Dormant contract expansion only. Requires quiesced migration with matching writers.
-- Context creation remains disabled until C2 completes export/erasure support.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER storage_accounts_insert;
DROP TRIGGER storage_context_grants_insert;
DROP TRIGGER storage_context_grants_update;
DROP TRIGGER storage_context_grants_delete;
CREATE TABLE context_grants_next (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  edition_id TEXT, reflection_id TEXT, reflection_revision INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), state TEXT NOT NULL CHECK(state IN('allowed','revoked')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  revisit_id TEXT, revisit_revision INTEGER CHECK(revisit_revision BETWEEN 1 AND 100),
  UNIQUE(owner_id,id),
  FOREIGN KEY(owner_id,edition_id) REFERENCES reading_editions(owner_id,id),
  FOREIGN KEY(owner_id,reflection_id,reflection_revision) REFERENCES reflection_revisions(owner_id,reflection_id,revision),
  FOREIGN KEY(owner_id,revisit_id) REFERENCES revisits(owner_id,id),
  CHECK(
    (edition_id IS NOT NULL AND reflection_id IS NULL AND reflection_revision IS NULL AND revisit_id IS NULL AND revisit_revision IS NULL) OR
    (edition_id IS NULL AND reflection_id IS NOT NULL AND reflection_revision IS NOT NULL AND revisit_id IS NULL AND revisit_revision IS NULL) OR
    (edition_id IS NULL AND reflection_id IS NULL AND reflection_revision IS NULL AND revisit_id IS NOT NULL AND revisit_revision IS NOT NULL)
  )
);
INSERT INTO context_grants_next(id,owner_id,edition_id,reflection_id,reflection_revision,revision,state,created_at,updated_at)
  SELECT id,owner_id,edition_id,reflection_id,reflection_revision,revision,state,created_at,updated_at FROM context_grants;
DROP TABLE context_grants;
ALTER TABLE context_grants_next RENAME TO context_grants;
CREATE INDEX grants_edition ON context_grants(owner_id,edition_id,state);
CREATE INDEX grants_reflection ON context_grants(owner_id,reflection_id,reflection_revision,state);
CREATE INDEX grants_revisit ON context_grants(owner_id,revisit_id,revisit_revision,state);
CREATE TRIGGER storage_context_grants_insert AFTER INSERT ON context_grants BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes+1024 WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_context_grants_delete AFTER DELETE ON context_grants BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes-1024 WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_context_grants_update AFTER UPDATE ON context_grants BEGIN
  UPDATE accounts SET storage_bytes=storage_bytes-1024 WHERE id=OLD.owner_id;
  UPDATE accounts SET storage_bytes=storage_bytes+1024 WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_accounts_insert AFTER INSERT ON accounts BEGIN
 UPDATE accounts SET storage_bytes=1024+
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
 coalesce((SELECT sum(1024+coalesce(length(CAST(import_items."body_enc" AS BLOB)),0)) FROM "import_items" WHERE owner_id=NEW.id),0)+
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
 1024*(SELECT count(*) FROM cost_adjustments a JOIN cost_reservations c ON c.id=a.cost_id WHERE c.owner_id=NEW.id) WHERE id=NEW.id;
END;
CREATE TABLE context_migration_integrity(violations INTEGER NOT NULL CHECK(violations=0));
INSERT INTO context_migration_integrity SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE context_migration_integrity;
PRAGMA defer_foreign_keys=OFF;
