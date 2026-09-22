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

    const source = readDebugSource((element as unknown as Record<string, unknown>)[key]);
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

function readDebugSource(fiber: unknown): SourcePath | null {
  if (!isRecord(fiber)) return null;
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
  if (match) {
    return {
      fileName: match[1],
      lineNumber: Number(match[2]),
    };
  }

  return { fileName: trimmed };
}

function normalizeSource(value: unknown): SourcePath | null {
  if (!isRecord(value) || typeof value.fileName !== 'string' || !value.fileName) return null;

  const source: SourcePath = { fileName: value.fileName };
  if (typeof value.lineNumber === 'number' && Number.isFinite(value.lineNumber)) {
    source.lineNumber = value.lineNumber;
  }
  return source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
