-- Passkey-only accounts have no password or login identifiers.
ALTER TABLE accounts ADD COLUMN login_username_hash TEXT CHECK(length(login_username_hash)=64);
ALTER TABLE accounts ADD COLUMN login_email_hash TEXT CHECK(length(login_email_hash)=64);
ALTER TABLE accounts ADD COLUMN password_verifier TEXT CHECK(
  (password_verifier IS NULL) = (login_username_hash IS NULL) AND
  (password_verifier IS NULL) = (login_email_hash IS NULL)
);
CREATE UNIQUE INDEX accounts_login_username ON accounts(login_username_hash) WHERE login_username_hash IS NOT NULL;
CREATE UNIQUE INDEX accounts_login_email ON accounts(login_email_hash) WHERE login_email_hash IS NOT NULL;

-- Setting a new password during registration or recovery is not an assertion
-- of an existing password for enrolling the first passkey.
ALTER TABLE auth_sessions ADD COLUMN password_authenticated_at INTEGER;
