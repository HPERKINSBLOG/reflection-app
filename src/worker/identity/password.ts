import { scrypt, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { PasswordRegistration } from '../../contracts/index.ts';
import { statement } from '../db/core.ts';
import { type Checkpoint, decode, encode, type IdentityCrypto, randomToken } from './crypto.ts';

type PasswordFactor = NonNullable<Checkpoint['password']>;
export type PasswordInput = z.infer<typeof PasswordRegistration>;

export function loginHash(crypt: IdentityCrypto, identifier: string) {
  const value = identifier.trim().toLowerCase();
  return crypt.hash(value.includes('@') ? 'login-email' : 'login-username', value);
}

// scrypt-v1 uses 16 MiB of working memory, with five passes. The independent
// identity secret also protects password guesses against a database-only leak.
async function derive(crypt: IdentityCrypto, owner: string, password: string, salt: string) {
  const input = await crypt.mac('password-input', [owner, password]);
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(input, decode(salt), 32, { N: 16384, r: 8, p: 5 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function passwordVerifier(crypt: IdentityCrypto, owner: string, password: string) {
  const salt = randomToken(16);
  return ['scrypt-v1', salt, encode(await derive(crypt, owner, password, salt))].join('$');
}

// Unknown identifiers do the same password work as an incorrect password.
const dummyVerifier = ['scrypt-v1', 'A'.repeat(22), 'A'.repeat(43)].join('$');
export async function verifyPassword(
  crypt: IdentityCrypto,
  owner: string,
  password: string,
  verifier: string | null,
) {
  const [version, salt, digest] = (verifier ?? dummyVerifier).split('$');
  if (version !== 'scrypt-v1' || !salt || !digest) throw new Error('Invalid password verifier');
  const matches = timingSafeEqual(await derive(crypt, owner, password, salt), decode(digest));
  return verifier !== null && matches;
}

export async function makePasswordFactor(
  crypt: IdentityCrypto,
  owner: string,
  input: PasswordInput,
): Promise<PasswordFactor> {
  const [usernameHash, emailHash, verifier] = await Promise.all([
    loginHash(crypt, input.username),
    loginHash(crypt, input.email),
    passwordVerifier(crypt, owner, input.password),
  ]);
  return { usernameHash, emailHash, verifier };
}

export function writePasswordFactor(db: D1Database, owner: string, factor: Checkpoint['password']) {
  return statement(
    db,
    'UPDATE accounts SET login_username_hash=?,login_email_hash=?,password_verifier=? WHERE id=?',
    factor?.usernameHash ?? null,
    factor?.emailHash ?? null,
    factor?.verifier ?? null,
    owner,
  );
}
