import { IMPORT_LIMITS } from '../../contracts/import-policy.ts';

export interface JsonNode {
  value: unknown;
  start: number;
  end: number;
  members: Map<string, JsonNode>;
  elements: JsonNode[];
}
const invalid = (): never => {
  throw new Error('IMPORT_INVALID');
};

/** Strict JSON with exact token spans. Duplicate/prototype keys are ambiguous and rejected.
 * No evaluation, reviver execution, HTML interpretation or access to host objects.
 */
export function readJson(text: string): JsonNode {
  let cursor = 0;
  const space = () => {
    while (/[\x20\t\n\r]/.test(text[cursor] ?? '!')) cursor++;
  };
  const string = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      const ch = text[cursor++];
      if (ch === '\\') cursor++;
      else if (ch === '"') {
        try {
          return JSON.parse(text.slice(start, cursor)) as string;
        } catch {
          invalid();
        }
      }
    }
    return invalid();
  };
  const node = (depth: number): JsonNode => {
    if (depth > IMPORT_LIMITS.depth) invalid();
    space();
    const start = cursor,
      members = new Map<string, JsonNode>(),
      elements: JsonNode[] = [];
    let value: unknown;
    if (text[cursor] === '{') {
      cursor++;
      space();
      const object: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (text[cursor] !== '}')
        for (;;) {
          space();
          if (text[cursor] !== '"') invalid();
          const key = string();
          if (['__proto__', 'prototype', 'constructor'].includes(key) || members.has(key))
            invalid();
          space();
          if (text[cursor++] !== ':') invalid();
          const child = node(depth + 1);
          members.set(key, child);
          object[key] = child.value;
          space();
          if (text[cursor] !== ',') break;
          cursor++;
        }
      if (text[cursor++] !== '}') invalid();
      value = object;
    } else if (text[cursor] === '[') {
      cursor++;
      space();
      if (text[cursor] !== ']')
        for (;;) {
          elements.push(node(depth + 1));
          space();
          if (text[cursor] !== ',') break;
          cursor++;
        }
      if (text[cursor++] !== ']') invalid();
      value = elements.map((e) => e.value);
    } else if (text[cursor] === '"') value = string();
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(cursor),
      );
      if (!token) return invalid();
      cursor += token[0].length;
      value = JSON.parse(token[0]) as unknown;
      if (typeof value === 'number' && !Number.isFinite(value)) invalid();
    }
    return { value, start, end: cursor, members, elements };
  };
  const result = node(0);
  space();
  if (cursor !== text.length) invalid();
  return result;
}

export const raw = (text: string, node: JsonNode) => text.slice(node.start, node.end);
export const field = (node: JsonNode, name: string) => node.members.get(name);
export const textField = (node: JsonNode, name: string): string | null => {
  const value = field(node, name)?.value;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return invalid();
  return value;
};
export const pointerPart = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');

/** Projection preserves exact lexical values while making its narrower scope explicit. */
export function projectFields(
  text: string,
  node: JsonNode,
  allowed: readonly string[],
  overrides: ReadonlyMap<string, string> = new Map(),
): string {
  if (node.value === null || typeof node.value !== 'object' || Array.isArray(node.value)) invalid();
  const fields = [];
  for (const [key, value] of node.members)
    if (allowed.includes(key))
      fields.push(`${JSON.stringify(key)}:${overrides.get(key) ?? raw(text, value)}`);
  return `{${fields.join(',')}}`;
}
export function assertFields(node: JsonNode, allowed: readonly string[]): void {
  if (
    node.value === null ||
    typeof node.value !== 'object' ||
    Array.isArray(node.value) ||
    [...node.members.keys()].some((k) => !allowed.includes(k))
  )
    invalid();
}
export function decodeImportBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalid();
  }
}
