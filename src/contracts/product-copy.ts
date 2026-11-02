/** Compiled plain text. Any change requires a new content hash and editorial approval. */
export const READING_PRODUCT_COPY = Object.freeze({
  unsupportedLanguage:
    'This version supports English. You can revise your question in English; your saved readings remain available.',
  crisis:
    'A tarot reading cannot provide crisis support. If you may be in immediate danger, contact local emergency services or a trusted person who can stay with you.',
  uncertainSafety:
    'This question needs care that this reading flow cannot provide. You can use your saved readings and personal reflections, or choose a different reflective question.',
  sensitiveAdvice:
    'This reading cannot make medical, legal or financial decisions. Consider asking about your priorities, feelings or the questions you want to discuss with a qualified professional.',
  providerRefusal:
    'The AI provider declined this request. No reading was accepted. Your saved readings and reflections remain available.',
  startProcessing:
    'Start temporarily stores your question and processing/recovery records for 24 hours from creation. Save reading keeps the result until you delete it.',
  saveReading:
    'Save keeps this reading, its cards and sources until deletion. No reflection is required.',
  aiPermission:
    'AI permission is separate from saving. It allows your question to be used for a new reading. Saved readings and reflections are not sent automatically.',
  serviceStorage:
    'Storage is encrypted and readable by the service for authorized operations. This is not end-to-end encryption.',
  providerRetention:
    'Live AI readings send your question, drawn cards, source text and any context you explicitly select to OpenAI. Requests use store:false. Provider abuse-monitoring and prompt-cache retention follow the project settings reviewed before live activation; store:false does not guarantee zero retention. This build uses a local simulated writer.',
  initialClosing: 'Use these prompts to reflect on what feels relevant to you.',
  followupClosing: 'This provides another reflection prompt based on the original draw.',
});

/** Photo-processing notices are UI disclosure, outside historical reading content. */
export const SPREAD_PHOTO_COPY = Object.freeze({
  spreadPhotoProcessing:
    'Starting this reading sends your attached photo to Meta for card recognition and stores it with the reading. Meta may retain request data under its API terms and account settings; zero retention is not guaranteed. Save reading keeps the photo until you delete the reading.',
  liveProviderRetention:
    'Your question, cards and selected source meanings are sent to OpenAI to write the reading. Any spread photo you attach is sent to Meta for recognition. Saved readings and reflections are not sent automatically. OpenAI and Meta may retain request data under their API terms and account settings; zero retention is not guaranteed.',
});

/** Authored-note retention disclosure; separate from historical reading content. */
export const REVISIT_PRODUCT_COPY = Object.freeze({
  disclosure:
    'This note is saved with this reading until you delete the note, reading or account. Editing keeps earlier saved versions, which are included in your export. Notes are encrypted at rest and can be read by this service when needed to show or manage them. Saving a note does not send it to an AI provider.',
});

/** Request-review copy is separate from frozen editorial content bundles. */
export const CONTEXT_PRODUCT_COPY = Object.freeze({
  eligibility:
    'Saving does not share a source. Allowing context eligibility only makes it available to select; it does not send text or select it for a request.',
  limits:
    'Select up to 3 distinct sources, 1,200 Unicode code points per excerpt and 3,000 total. Every excerpt is reviewed in full; nothing is silently shortened.',
  removeRevoke:
    'Remove from this request keeps the source and its eligibility. Revoke context eligibility blocks future use without deleting the source or retracting text already sent.',
  recipient:
    'Starting a live reading sends the current question, cards, eligible source canon and exactly these excerpts to OpenAI. Notes, stance, photos, filenames and other history are not included in this context packet. OpenAI uses store:false; this does not guarantee zero retention under provider abuse-monitoring and prompt-cache settings.',
  synthetic:
    'This simulation uses the current question, cards, eligible source canon and exactly these excerpts in this service. It does not contact an AI provider. Use synthetic text only.',
  retention:
    'Preview and eligibility do not call a provider. Starting stores selected copies with the reading and its processing records; they share the reading’s retention and deletion. Storage is encrypted at rest and readable by the service for authorized operations. Unsaved selections and acknowledgements stay in memory and are lost on reload.',
});
