import type { Annotation } from '../annotation';

export const exportTemplates = [
  { id: 'generic', label: 'Generic' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
] as const;

export type ExportTemplate = (typeof exportTemplates)[number]['id'];

type TemplateDefinition = {
  heading: string;
  guidance: string;
};

const templateDefinitions: Record<ExportTemplate, TemplateDefinition> = {
  generic: {
    heading: '# Page annotations',
    guidance: 'Review the following annotations for this page.',
  },
  'claude-code': {
    heading: '# Claude Code task context',
    guidance: 'Use these page annotations to guide the implementation.',
  },
  cursor: {
    heading: '# Cursor page context',
    guidance: 'Use these page annotations while editing the codebase.',
  },
};

export function format(annotations: Annotation[], template: ExportTemplate, pageUrl: string): string {
  if (annotations.length === 0) return 'No annotations found on this page.';

  const definition = templateDefinitions[template];
  const blocks = annotations.map((annotation, index) => {
    const sourcePath = readSourcePath(annotation.elementContext);
    const lines = [
      `## Annotation ${index + 1}`,
      `- Note: ${annotation.note}`,
      `- Selector: ${annotation.selector}`,
      sourcePath ? `- Source: ${sourcePath}` : undefined,
      annotation.screenshot ? `![Annotation screenshot](${annotation.screenshot})` : undefined,
      annotation.repro
        ? [
            '### Reproduction',
            ...annotation.repro.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
            `Expected: ${annotation.repro.expected}`,
            `Actual: ${annotation.repro.actual}`,
          ].join('\n')
        : undefined,
      annotation.cssEdits && annotation.cssEdits.length > 0
        ? ['### CSS tweaks', ...annotation.cssEdits.map(({ property, value }) => `${property}: ${value}`)].join('\n')
        : undefined,
    ];
    return lines.filter((line): line is string => line !== undefined).join('\n');
  });

  return [definition.heading, definition.guidance, `Page: ${pageUrl}`, ...blocks].join('\n\n');
}

function readSourcePath(elementContext: unknown): string | undefined {
  if (!isRecord(elementContext) || !isRecord(elementContext.sourcePath)) return undefined;

  const { fileName, lineNumber } = elementContext.sourcePath;
  if (typeof fileName !== 'string' || fileName.length === 0) return undefined;
  if (typeof lineNumber === 'number' && Number.isFinite(lineNumber)) return `${fileName}:${lineNumber}`;
  return fileName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
