import { isObject } from '../guards';

export interface SourcePath {
  fileName: string;
  lineNumber?: number;
}

interface DebugSource {
  fileName?: unknown;
  lineNumber?: unknown;
}

export function resolveSourcePath(element: Element): SourcePath | null {
  for (const key of Object.getOwnPropertyNames(element)) {
    if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;

    const source = readDebugSource(readOwnProperty(element, key));
    if (source) return source;
  }

  for (const attribute of Array.from(element.attributes)) {
    if (!attribute.name.startsWith('data-') || !/source|file|component|loc/.test(attribute.name)) {
      continue;
    }

    const source = parseSourceHint(attribute.value);
    if (source) return source;
  }

  return null;
}

function readOwnProperty(element: Element, key: string): unknown {
  return Reflect.get(element, key);
}

function readDebugSource(fiber: unknown): SourcePath | null {
  if (!isObject(fiber)) return null;
  return normalizeSource(fiber._debugSource);
}

function parseSourceHint(value: string): SourcePath | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const source = normalizeSource(parsed);
    if (source) return source;
  } catch {
    // Source hints are best effort and may be plain file paths.
  }

  const match = /^(.*?)(?::(\d+))(?::\d+)?$/.exec(trimmed);
  const fileName = match?.[1];
  const lineNumber = match?.[2];
  if (fileName !== undefined && lineNumber !== undefined) {
    return {
      fileName,
      lineNumber: Number(lineNumber),
    };
  }

  return { fileName: trimmed };
}

function normalizeSource(value: unknown): SourcePath | null {
  if (!isObject(value) || typeof value.fileName !== 'string' || !value.fileName) return null;

  const source: SourcePath = { fileName: value.fileName };
  if (typeof value.lineNumber === 'number' && Number.isFinite(value.lineNumber)) {
    source.lineNumber = value.lineNumber;
  }
  return source;
}
