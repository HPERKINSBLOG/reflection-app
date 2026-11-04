/** Staged ciphertext already has its final row's AAD and can be published with INSERT ... SELECT. */
export const importFields = {
  session: ['reading_sessions', 'question_enc'],
  edition: ['reading_editions', 'body_enc'],
  reflection: ['reflection_revisions', 'body_enc'],
  revisit: ['revisits', 'note_enc'],
  revisit_revision: ['revisit_revisions', 'body_enc'],
  alias: ['import_identities', 'source_record_enc'],
} as const;
