-- Encrypted, bounded import previews and durable group outcomes. No plaintext upload is retained.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER storage_accounts_insert;
DROP TRIGGER storage_import_items_insert;
DROP TRIGGER storage_import_items_update;
DROP TRIGGER storage_import_items_delete;
CREATE TABLE import_groups (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 manifest_hash TEXT NOT NULL, total_items INTEGER NOT NULL CHECK(total_items BETWEEN 1 AND 20480),
 state TEXT NOT NULL CHECK(state IN('staged','committing','complete','failed','expired')),
 header_enc TEXT, preview_hmac TEXT, recovery_hmac TEXT NOT NULL, key_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, outcome_expires_at INTEGER NOT NULL,
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version)
);
CREATE INDEX import_group_expiry ON import_groups(state,expires_at,outcome_expires_at);
CREATE TABLE import_items_next (
 batch_id TEXT NOT NULL, owner_id TEXT NOT NULL, item_index INTEGER NOT NULL CHECK(item_index BETWEEN 0 AND 99),
 source_key_hmac TEXT NOT NULL, original_hmac TEXT NOT NULL, body_enc TEXT,
 key_version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN('ready','duplicate','conflict','erased','invalid','imported','failed')),
 session_id TEXT, error_code TEXT, group_id TEXT, ordinal INTEGER CHECK(ordinal BETWEEN 0 AND 20479),
 source_entity_hmac TEXT, result_enc TEXT, withheld_at INTEGER,
 PRIMARY KEY(batch_id,item_index), UNIQUE(owner_id,group_id,ordinal),
 FOREIGN KEY(owner_id,batch_id) REFERENCES import_batches(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,session_id) REFERENCES reading_sessions(owner_id,id),
 FOREIGN KEY(owner_id,group_id) REFERENCES import_groups(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version),
 CHECK((group_id IS NULL)=(ordinal IS NULL))
);
INSERT INTO import_items_next(batch_id,owner_id,item_index,source_key_hmac,original_hmac,body_enc,key_version,state,session_id,error_code)
 SELECT batch_id,owner_id,item_index,source_key_hmac,original_hmac,body_enc,key_version,state,session_id,error_code FROM import_items;
DROP TABLE import_items;
ALTER TABLE import_items_next RENAME TO import_items;
CREATE INDEX import_items_entity ON import_items(owner_id,source_entity_hmac);
ALTER TABLE import_identities ADD COLUMN revisit_revision INTEGER CHECK(revisit_revision IS NULL OR (revisit_revision BETWEEN 1 AND 100 AND entity_kind='revisit' AND erased_at IS NULL AND revisit_id IS NOT NULL));
ALTER TABLE import_identities ADD COLUMN materialized INTEGER NOT NULL DEFAULT 1 CHECK(materialized IN(0,1));
ALTER TABLE import_identities ADD COLUMN withheld_at INTEGER;
-- Deliberately no source FK: provenance must survive a missing primary source on restore.
CREATE TABLE import_copy_sources (
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 copy_kind TEXT NOT NULL CHECK(copy_kind IN('item','alias')), copy_id TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN('session','edition','reflection_revision','revisit_revision')),
 source_id TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 PRIMARY KEY(owner_id,copy_kind,copy_id,source_kind,source_id,source_revision)
);
CREATE INDEX import_copy_target ON import_copy_sources(owner_id,source_kind,source_id,source_revision);
CREATE TRIGGER storage_import_groups_insert AFTER INSERT ON "import_groups" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."header_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_groups_delete AFTER DELETE ON "import_groups" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."header_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_groups_update AFTER UPDATE ON "import_groups" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."header_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."header_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_items_insert AFTER INSERT ON "import_items" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)+coalesce(length(CAST(NEW."result_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_items_delete AFTER DELETE ON "import_items" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)+coalesce(length(CAST(OLD."result_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_items_update AFTER UPDATE ON "import_items" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)+coalesce(length(CAST(OLD."result_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)+coalesce(length(CAST(NEW."result_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_copy_sources_insert AFTER INSERT ON "import_copy_sources" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_copy_sources_delete AFTER DELETE ON "import_copy_sources" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_copy_sources_update AFTER UPDATE ON "import_copy_sources" BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_accounts_insert AFTER INSERT ON accounts BEGIN
 UPDATE accounts SET storage_bytes=1024+
 coalesce((SELECT sum(1024+coalesce(length(CAST(header_enc AS BLOB)),0)) FROM import_groups WHERE owner_id=NEW.id),0)+
 coalesce((SELECT sum(1024) FROM import_copy_sources WHERE owner_id=NEW.id),0)+
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
 1024*(SELECT count(*) FROM cost_adjustments a JOIN cost_reservations c ON c.id=a.cost_id WHERE c.owner_id=NEW.id) WHERE id=NEW.id;
END;
