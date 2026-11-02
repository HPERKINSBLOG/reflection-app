import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/** Reject links in every existing ancestor, including Windows directory junctions. */
export function protectedPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('Absolute protected path required');
  const result = resolve(path);
  for (let cursor = result; ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('Protected path is a symlink');
    if (cursor === dirname(cursor)) break;
  }
  return result;
}

// Paths are JSON data on stdin, never PowerShell source. NTFS ACLs, not the
// POSIX mode bits synthesized by Node on Windows, determine who can read a file.
const windowsAcl = Buffer.from(
  `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $isDirectory = [IO.Directory]::Exists($request.path)
  $item = if ($isDirectory) { [IO.DirectoryInfo]::new($request.path) } else { [IO.FileInfo]::new($request.path) }
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Link rejected' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.protect) {
    if ($isDirectory) {
      $acl = New-Object Security.AccessControl.DirectorySecurity
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    } else {
      $acl = New-Object Security.AccessControl.FileSecurity
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
    }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    $item.SetAccessControl($acl)
  }
  $acl = $item.GetAccessControl()
  $private = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value
  $readable = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    if ($rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) { $private = $false }
    if ($rule.IdentityReference.Value -eq $sid.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData)) { $readable = $true }
  }
  [Console]::Out.Write(($private -and $readable).ToString().ToLowerInvariant())
} catch { [Console]::Error.Write('Protected path ACL operation failed'); exit 1 }
`,
  'utf16le',
).toString('base64');

function acl(path: string, protect = false): boolean {
  return (
    execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', windowsAcl],
      {
        input: JSON.stringify({ path, protect }),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim() === 'true'
  );
}

export function hasPrivateAccess(path: string): boolean {
  const target = protectedPath(path);
  const stat = lstatSync(target);
  if (!stat.isFile() && !stat.isDirectory()) return false;
  return process.platform === 'win32' ? acl(target) : (stat.mode & 0o077) === 0;
}

/** Apply owner-only permissions to a newly created file, before writing data. */
export function protectPrivatePath(path: string): void {
  const target = protectedPath(path);
  if (process.platform === 'win32') {
    if (!acl(target, true)) throw new Error('Private path ACL could not be established');
  } else chmodSync(target, lstatSync(target).isDirectory() ? 0o700 : 0o600);
}

export function privateDirectory(path: string): string {
  const target = protectedPath(path);
  if (existsSync(target)) {
    if (!lstatSync(target).isDirectory() || !hasPrivateAccess(target))
      throw new Error('Directory must be private');
  } else {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    protectPrivatePath(target);
  }
  return target;
}

export function writePrivateFile(path: string, bytes: string | Uint8Array): void {
  const target = protectedPath(path);
  const fd = openSync(target, 'wx', 0o600);
  try {
    protectPrivatePath(target);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Windows cannot open a directory through Node's fs API for fsync. The file
  // itself is flushed above on every platform; POSIX also flushes its directory.
  if (process.platform !== 'win32') {
    const parent = openSync(dirname(target), 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  }
}
