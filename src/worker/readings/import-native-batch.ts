import type { Unit } from '../../domain/imports/types.ts';
import type { Session } from '../identity/types.ts';
import { RecordBase } from './base.ts';
import { nativeImport } from './import-native.ts';

/** Coalesce the read-only native reconciliation lane into real D1 batches.
 * This adapter is request-local and must never be used for writes: independent
 * record checks share a transaction, but retain each check's result boundaries.
 */
export async function nativeImports(base: RecordBase, session: Session, units: Unit[]) {
  type Result = D1Result<Record<string, unknown>>;
  type Pending = {
    statements: D1PreparedStatement[];
    resolve: (value: Result[]) => void;
    reject: (error: unknown) => void;
  };
  let pending: Pending[] = [];
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const batch = (statements: D1PreparedStatement[]) =>
    new Promise<Result[]>((resolve, reject) => {
      pending.push({ statements: statements.map((s) => originals.get(s) ?? s), resolve, reject });
      if (pending.length !== 1) return;
      setTimeout(() => {
        const requests = pending;
        pending = [];
        void base.db.batch<Record<string, unknown>>(requests.flatMap((r) => r.statements)).then(
          (results) => {
            let offset = 0;
            for (const request of requests) {
              request.resolve(results.slice(offset, offset + request.statements.length));
              offset += request.statements.length;
            }
          },
          (error) =>
            requests.forEach((request) => {
              request.reject(error);
            }),
        );
      }, 0);
    });
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'first')
          return async (column?: string) => {
            const row = (await batch([target]))[0]!.results[0];
            return row ? (column === undefined ? row : (row[column] ?? null)) : null;
          };
        if (property === 'all' || property === 'run')
          return async () => (await batch([target]))[0]!;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    originals.set(wrapped, statement);
    return wrapped;
  };
  const db = new Proxy(base.db, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (property === 'batch') return batch;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const reader = new RecordBase(db, base.identity),
    results = new Map<Unit, Awaited<ReturnType<typeof nativeImport>>>();
  // Bounds concurrent decrypted records; the account's 20MiB cap also bounds assembly.
  for (let start = 0; start < units.length; start += 100)
    await Promise.all(
      units.slice(start, start + 100).map(async (unit) => {
        results.set(unit, await nativeImport(reader, session, unit));
      }),
    );
  return results;
}
