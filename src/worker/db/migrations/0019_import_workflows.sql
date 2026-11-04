-- Quiesce writers and deploy the matching Worker. Existing preview rows keep their original AAD.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER storage_accounts_insert;
DROP TRIGGER storage_import_batches_insert;
DROP TRIGGER storage_import_batches_delete;
DROP TRIGGER storage_import_batches_update;
DROP TRIGGER storage_import_items_insert;
DROP TRIGGER storage_import_items_delete;
DROP TRIGGER storage_import_items_update;
CREATE TABLE import_groups (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 manifest_hash TEXT NOT NULL, source_hmac TEXT NOT NULL, recovery_hmac TEXT NOT NULL, epoch INTEGER NOT NULL,
 unit_count INTEGER NOT NULL CHECK(unit_count BETWEEN 1 AND 20480), preview_hash TEXT,
 state TEXT NOT NULL CHECK(state IN('staged','committing','complete','failed','expired')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, retain_until INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER,
 UNIQUE(owner_id,id), CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX import_groups_expiry ON import_groups(state,expires_at,retain_until);
CREATE TABLE import_batches_next (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 source_format TEXT NOT NULL, document_hmac TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('preview','committing','complete','expired')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, group_id TEXT,
 UNIQUE(owner_id,id), UNIQUE(owner_id,id,group_id),
 FOREIGN KEY(owner_id,group_id) REFERENCES import_groups(owner_id,id) ON DELETE CASCADE
);
INSERT INTO import_batches_next(id,owner_id,source_format,document_hmac,state,created_at,expires_at)
 SELECT id,owner_id,source_format,document_hmac,state,created_at,expires_at FROM import_batches;
CREATE TABLE import_items_next (
 batch_id TEXT NOT NULL, owner_id TEXT NOT NULL, item_index INTEGER NOT NULL CHECK(item_index BETWEEN 0 AND 99),
 source_key_hmac TEXT NOT NULL, original_hmac TEXT NOT NULL, body_enc TEXT,
 key_version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN('ready','duplicate','conflict','erased','invalid','imported','failed')),
 session_id TEXT, error_code TEXT, group_id TEXT, ordinal INTEGER CHECK(ordinal BETWEEN 0 AND 20479),
 source_entity_hmac TEXT, result_enc TEXT, PRIMARY KEY(batch_id,item_index),
 UNIQUE(owner_id,group_id,ordinal), UNIQUE(owner_id,group_id,source_key_hmac),
 FOREIGN KEY(owner_id,batch_id) REFERENCES import_batches_next(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,batch_id,group_id) REFERENCES import_batches_next(owner_id,id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,session_id) REFERENCES reading_sessions(owner_id,id),
 FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version),
 CHECK((group_id IS NULL)=(ordinal IS NULL))
);
INSERT INTO import_items_next(batch_id,owner_id,item_index,source_key_hmac,original_hmac,body_enc,key_version,state,session_id,error_code)
 SELECT batch_id,owner_id,item_index,source_key_hmac,original_hmac,body_enc,key_version,state,session_id,error_code FROM import_items;
DROP TABLE import_items;
DROP TABLE import_batches;
ALTER TABLE import_batches_next RENAME TO import_batches;
ALTER TABLE import_items_next RENAME TO import_items;
CREATE INDEX import_expiry ON import_batches(state,expires_at);
CREATE INDEX import_group_batches ON import_batches(owner_id,group_id);
CREATE INDEX import_item_entity ON import_items(owner_id,source_entity_hmac);
ALTER TABLE import_identities ADD COLUMN revisit_revision INTEGER CHECK(revisit_revision IS NULL OR (entity_kind='revisit' AND erased_at IS NULL AND revisit_revision BETWEEN 1 AND 100));
CREATE TABLE import_staging (
 owner_id TEXT NOT NULL, group_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('session','edition','reflection','revisit','revisit_revision','alias')),
 source_entity_hmac TEXT NOT NULL, target_id TEXT NOT NULL, meta_json TEXT NOT NULL CHECK(json_valid(meta_json)),
 field_enc TEXT, key_version INTEGER NOT NULL,
 PRIMARY KEY(owner_id,group_id,ordinal,kind),
 FOREIGN KEY(owner_id,group_id,ordinal) REFERENCES import_items(owner_id,group_id,ordinal) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,key_version) REFERENCES account_keys(owner_id,version)
);
CREATE INDEX import_staging_entity ON import_staging(owner_id,source_entity_hmac);
CREATE TABLE import_copy_sources (
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 source_entity_hmac TEXT NOT NULL, dependent_entity_hmac TEXT NOT NULL,
 PRIMARY KEY(owner_id,source_entity_hmac,dependent_entity_hmac)
);
CREATE INDEX import_copy_dependents ON import_copy_sources(owner_id,dependent_entity_hmac);
CREATE TRIGGER storage_import_batches_insert AFTER INSERT ON import_batches BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_batches_delete AFTER DELETE ON import_batches BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_batches_update AFTER UPDATE OF owner_id ON import_batches BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_items_insert AFTER INSERT ON import_items BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)+coalesce(length(CAST(NEW."result_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_items_delete AFTER DELETE ON import_items BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)+coalesce(length(CAST(OLD."result_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_items_update AFTER UPDATE OF owner_id, body_enc, result_enc ON import_items BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."body_enc" AS BLOB)),0)+coalesce(length(CAST(OLD."result_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."body_enc" AS BLOB)),0)+coalesce(length(CAST(NEW."result_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_groups_insert AFTER INSERT ON import_groups BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_groups_delete AFTER DELETE ON import_groups BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_groups_update AFTER UPDATE OF owner_id ON import_groups BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_staging_insert AFTER INSERT ON import_staging BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."field_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_staging_delete AFTER DELETE ON import_staging BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."field_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_staging_update AFTER UPDATE OF owner_id, field_enc ON import_staging BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024+coalesce(length(CAST(OLD."field_enc" AS BLOB)),0)) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024+coalesce(length(CAST(NEW."field_enc" AS BLOB)),0)) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_copy_sources_insert AFTER INSERT ON import_copy_sources BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
END;
CREATE TRIGGER storage_import_copy_sources_delete AFTER DELETE ON import_copy_sources BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
END;
CREATE TRIGGER storage_import_copy_sources_update AFTER UPDATE OF owner_id ON import_copy_sources BEGIN
 UPDATE accounts SET storage_bytes=storage_bytes-(1024) WHERE id=OLD.owner_id;
 UPDATE accounts SET storage_bytes=storage_bytes+(1024) WHERE id=NEW.owner_id;
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
CREATE TABLE import_migration_integrity(violations INTEGER NOT NULL CHECK(violations=0));
INSERT INTO import_migration_integrity SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE import_migration_integrity;
PRAGMA defer_foreign_keys=OFF;
