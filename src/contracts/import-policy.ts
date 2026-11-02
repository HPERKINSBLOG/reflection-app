export const IMPORT_LIMITS = {
  bodyBytes: 2 * 1024 * 1024,
  documentUnits: 200000,
  recordBytes: 192 * 1024,
  nativeRecordBytes: 64 * 1024,
  exportPageBytes: 1024 * 1024,
  previewItems: 100,
  // Browser-side file normalization; the server receives only bounded selected chunks.
  fileBytes: 32 * 1024 * 1024,
  depth: 64,
  assemblyItems: 20480,
} as const;
