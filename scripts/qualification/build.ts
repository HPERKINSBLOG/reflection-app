import { build } from 'esbuild';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const [outputDirectory] = process.argv.slice(2);
if (!outputDirectory)
  throw Error('Usage: tsx scripts/qualification/build.ts PRIVATE_OUTPUT_DIRECTORY');
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
const tokenPath = resolve(outputDirectory, 'authorization');
if (!existsSync(tokenPath))
  writeFileSync(tokenPath, `Bearer ${randomBytes(32).toString('base64url')}`, {
    mode: 0o600,
    flag: 'wx',
  });
const result = await build({
  entryPoints: ['scripts/qualification/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  metafile: true,
  external: ['node:*', 'cloudflare:*'],
});
const bytes = result.outputFiles[0]!.contents;
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
writeFileSync(resolve(outputDirectory, 'worker.js'), bytes);
writeFileSync(resolve(outputDirectory, 'worker.js.gz'), gzipSync(bytes));
const receipt = {
  kind: 'pattern.qualification-bundle.v1',
  sha256: hash(bytes),
  bytes: bytes.length,
  gzipBytes: gzipSync(bytes).length,
  tokenSha256: hash(readFileSync(tokenPath)),
  inputs: Object.fromEntries(
    Object.keys(result.metafile.inputs).map((path) => [path, hash(readFileSync(path))]),
  ),
};
writeFileSync(resolve(outputDirectory, 'build.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  JSON.stringify({
    bytes: receipt.bytes,
    gzipBytes: receipt.gzipBytes,
    sha256: receipt.sha256,
    tokenSha256: receipt.tokenSha256,
    outputDirectory,
  }),
);
