-- Run inside the publication D1 batch, immediately before the published-state
-- update. Earlier statements roll back on failure; a prior read is insufficient.
-- Deadline authority is the database execution clock, never a bound worker time.
-- Failure deliberately violates CHECK(ok=1), rolling back the whole batch.
INSERT INTO assertion_probe(ok)
WITH eligible_snapshots AS MATERIALIZED (
  -- Start with the at-most-three plan identities so the snapshot lookup uses (request_id,ordinal).
  SELECT x.ordinal FROM json_each(:expected_context) i
  CROSS JOIN generation_context x ON x.request_id=:request_id AND x.owner_id=:owner_id AND x.ordinal=i.key
  JOIN context_grants g ON g.owner_id=x.owner_id AND g.id=x.grant_id
  WHERE x.grant_id=i.value->>'$.grantId' AND x.grant_revision=i.value->>'$.grantRevision'
    AND x.fragment_hmac=i.value->>'$.fragmentHmac' AND length(x.fragment_hmac)=64
    AND x.fragment_hmac NOT GLOB '*[^0-9a-f]*' AND length(trim(x.fragment_enc))>0
    AND x.key_version=:key_version AND g.revision=x.grant_revision AND g.state='allowed'
    AND CASE i.value->>'$.sourceKind'
      WHEN 'edition' THEN g.edition_id=i.value->>'$.sourceId' AND EXISTS (
        SELECT 1 FROM reading_editions e WHERE e.owner_id=g.owner_id AND e.id=g.edition_id
          AND e.edition_number=i.value->>'$.sourceRevision')
      WHEN 'reflection_revision' THEN g.reflection_id=i.value->>'$.sourceId' AND g.reflection_revision=i.value->>'$.sourceRevision'
      WHEN 'revisit_revision' THEN g.revisit_id=i.value->>'$.sourceId' AND g.revisit_revision=i.value->>'$.sourceRevision'
    END
    AND
    -- BEGIN eligible grant source
    (
      EXISTS (
        SELECT 1 FROM reading_editions e
        JOIN reading_sessions s ON s.owner_id=e.owner_id AND s.id=e.session_id AND s.status='saved'
        WHERE e.owner_id=g.owner_id AND e.id=g.edition_id AND length(e.body_enc)>0
          AND ((e.status='imported' AND e.mode='legacy')
            OR (e.status='accepted' AND e.mode IN('model','template') AND EXISTS (
              SELECT 1 FROM content_editions ec WHERE ec.hash=e.content_hash
                AND ec.state IN('approved','superseded') AND ec.rights_status='cleared')))
      ) OR EXISTS (
        SELECT 1 FROM reflections f
        JOIN reflection_revisions v ON v.owner_id=f.owner_id AND v.reflection_id=f.id AND v.revision=f.current_revision
        JOIN reading_editions e ON e.owner_id=f.owner_id AND e.id=f.edition_id AND e.session_id=f.session_id
        JOIN reading_sessions s ON s.owner_id=e.owner_id AND s.id=e.session_id AND s.status='saved'
        WHERE f.owner_id=g.owner_id AND f.id=g.reflection_id AND f.current_revision=g.reflection_revision
          AND f.deleted_at IS NULL AND v.erased_at IS NULL AND length(v.body_enc)>0 AND e.status!='deleted'
      ) OR EXISTS (
        SELECT 1 FROM revisits n
        JOIN reading_editions e ON e.owner_id=n.owner_id AND e.id=n.edition_id AND e.session_id=n.session_id
        JOIN reading_sessions s ON s.owner_id=e.owner_id AND s.id=e.session_id AND s.status='saved'
        WHERE n.owner_id=g.owner_id AND n.id=g.revisit_id AND n.current_revision=g.revisit_revision
          AND n.deleted_at IS NULL AND length(n.note_enc)>0 AND e.status!='deleted'
      )
    )
    -- END eligible grant source
)
SELECT 0
WHERE NOT EXISTS (
  SELECT 1 FROM generation_requests r
  JOIN (SELECT count(*) AS n FROM eligible_snapshots) eligible ON eligible.n=r.context_count
  JOIN accounts a ON a.id=r.owner_id
  JOIN account_keys k ON k.owner_id=a.id AND k.version=a.key_version
  JOIN reading_sessions s ON s.owner_id=r.owner_id AND s.id=r.session_id
  JOIN basis_snapshots b ON b.owner_id=r.owner_id AND b.id=r.basis_id AND b.session_id=r.session_id
  JOIN permission_revisions p ON p.owner_id=a.id AND p.revision=a.permission_revision
  JOIN content_editions c ON c.hash=r.content_hash
  JOIN system_state sys ON sys.id=1
  WHERE r.id=:request_id AND r.owner_id=:owner_id
    AND a.status='active' AND a.write_fence IS NULL
    AND a.recovery_ack_at IS NOT NULL
    AND a.key_version=:key_version AND r.key_version=:key_version
    AND a.permission_revision=r.permission_revision AND p.model_allowed=1
    AND s.status IN('open','saved') AND b.body_enc IS NOT NULL
    AND r.run_epoch=:run_epoch AND r.lease_token=:lease_token
    AND r.lease_expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND r.state=:expected_state AND r.state IN('validating','fallback_pending')
    AND r.plan_hmac=:plan_hmac AND r.plan_enc IS NOT NULL
    AND r.context_count=:context_count
    AND json_array_length(:expected_context)=r.context_count
    AND (SELECT count(*) FROM generation_context xc WHERE xc.request_id=r.id)=r.context_count
    AND r.content_policy_revision=c.policy_revision
    AND c.state IN('approved','superseded') AND c.rights_status='cleared'
    AND c.reviewed_hash=c.hash AND c.reviewer_kind='human_approved'
    AND sys.generation_enabled=1 AND sys.provider_policy_hash=r.policy_hash
    AND r.parent_edition_id IS :parent_edition_id
    AND (r.parent_edition_id IS NULL OR (s.status='saved' AND EXISTS (
      SELECT 1 FROM reading_editions parent
      WHERE parent.owner_id=r.owner_id AND parent.id=r.parent_edition_id
        AND parent.session_id=r.session_id AND parent.basis_id=r.basis_id
        AND parent.status='accepted' AND parent.mode IN('model','template') AND length(parent.body_enc)>0
        AND EXISTS (SELECT 1 FROM content_editions pc WHERE pc.hash=parent.content_hash
          AND pc.state IN('approved','superseded') AND pc.rights_status='cleared'))))
);
