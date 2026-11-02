import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  hasPrivateAccess,
  privateDirectory,
  writePrivateFile,
} from '../../scripts/private-files.ts';

const temporary: string[] = [];
function root() {
  const path = mkdtempSync(join(tmpdir(), 'reflection-private-'));
  temporary.push(path);
  return path;
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('private files retain exact bytes, reject replacement and use actual platform permissions', () => {
  const directory = join(root(), "private résumé [1]'$");
  privateDirectory(directory);
  const file = join(directory, 'evidence.json');
  writePrivateFile(file, 'synthetic evidence\n');
  expect(hasPrivateAccess(directory)).toBe(true);
  expect(hasPrivateAccess(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toBe('synthetic evidence\n');
  expect(() => writePrivateFile(file, 'replacement')).toThrow();
  expect(readFileSync(file, 'utf8')).toBe('synthetic evidence\n');
});

test('read access granted to other users is rejected without silently changing it', () => {
  const file = join(root(), 'shared.json');
  writePrivateFile(file, 'synthetic');
  if (process.platform === 'win32') {
    execFileSync('icacls.exe', [file, '/grant', '*S-1-1-0:R'], {
      windowsHide: true,
      stdio: 'pipe',
    });
  } else chmodSync(file, 0o644);
  expect(hasPrivateAccess(file)).toBe(false);
  expect(hasPrivateAccess(file)).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe('synthetic');
});

test('private access rejects paths through a directory link', () => {
  const directory = root();
  const target = join(directory, 'private');
  privateDirectory(target);
  writePrivateFile(join(target, 'evidence.json'), 'synthetic');
  const link = join(directory, 'alias');
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => hasPrivateAccess(join(link, 'evidence.json'))).toThrow(/symlink/);
});

test('an existing shared directory is rejected rather than silently changing its permissions', () => {
  const directory = root();
  if (process.platform === 'win32')
    execFileSync('icacls.exe', [directory, '/grant', '*S-1-1-0:(OI)(CI)R'], {
      windowsHide: true,
      stdio: 'pipe',
    });
  else chmodSync(directory, 0o755);
  expect(() => privateDirectory(directory)).toThrow(/private/);
  expect(hasPrivateAccess(directory)).toBe(false);
});
