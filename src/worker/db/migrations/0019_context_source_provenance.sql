-- Durable family identity is independent of an original authored row surviving restore.
ALTER TABLE context_grants ADD COLUMN source_session_id TEXT REFERENCES reading_sessions(id);
UPDATE context_grants SET source_session_id=coalesce(
 (SELECT session_id FROM reading_editions e WHERE e.owner_id=context_grants.owner_id AND e.id=context_grants.edition_id),
 (SELECT session_id FROM reflections f WHERE f.owner_id=context_grants.owner_id AND f.id=context_grants.reflection_id),
 (SELECT session_id FROM revisits n WHERE n.owner_id=context_grants.owner_id AND n.id=context_grants.revisit_id));
CREATE INDEX grants_source_family ON context_grants(owner_id,source_session_id);
CREATE TRIGGER context_grant_source_owner_insert BEFORE INSERT ON context_grants
 WHEN NEW.source_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reading_sessions WHERE owner_id=NEW.owner_id AND id=NEW.source_session_id)
 BEGIN SELECT RAISE(ABORT,'context source owner mismatch'); END;
CREATE TRIGGER context_grant_source_owner_update BEFORE UPDATE OF owner_id,source_session_id ON context_grants
 WHEN NEW.source_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reading_sessions WHERE owner_id=NEW.owner_id AND id=NEW.source_session_id)
 BEGIN SELECT RAISE(ABORT,'context source owner mismatch'); END;
