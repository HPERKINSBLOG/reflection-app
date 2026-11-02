-- A pending durable erasure hides copies before the independent ledger is available.
-- Revocation alone preserves owned export and therefore cannot serve as this fence.
ALTER TABLE generation_requests ADD COLUMN context_withdrawn_at INTEGER;
