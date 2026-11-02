import type { z } from 'zod';
import type {
  ImportUnit,
  ImportRecordIdentity,
  ImportRecovery,
  ImportSource,
  apiSchemas,
} from '../../contracts/index.ts';
export type Unit = z.infer<typeof ImportUnit>;
export type Identity = z.infer<typeof ImportRecordIdentity>;
export type Source = z.infer<typeof ImportSource>;
export type Recovery = z.infer<typeof ImportRecovery>;
export type ImportWrite = z.infer<typeof apiSchemas.ImportWrite>;
export interface FileInput {
  format: string;
  source: Source;
  recovery: Recovery;
  document: string;
}
export interface NormalizedImport {
  source: Source;
  recovery: Recovery;
  units: Unit[];
  errors: { pointer: string; code: 'IMPORT_INVALID' | 'INPUT_TOO_LARGE' }[];
}
export interface ImportGroup {
  id: string;
  manifestHash: string;
  units: Unit[];
  chunks: ImportWrite[];
  unresolved: Unit['dependencies'];
}
