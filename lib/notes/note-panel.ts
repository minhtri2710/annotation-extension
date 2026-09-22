import type { Annotation, CssEdit } from '../annotation';
import type { ElementContext } from '../capture/context';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { createNotePanelPersistence, type NotePanelPersistence } from './persistence';

export interface NotePanel {
  render(context: ElementContext): Promise<void>;
  teardown(): void;
}

export function createNotePanel(
  panel: HTMLElement,
  persistence: NotePanelPersistence = createNotePanelPersistence(),
): NotePanel {
  let selectedContext: ElementContext | undefined;

  async function render(context: ElementContext): Promise<void> {
    selectedContext = context;
    const annotations = (await persistence.listAnnotations(context.url)).filter(
      (annotation) => annotation.selector === context.selector,
    );
    if (selectedContext !== context) return;

    panel.replaceChildren();
    const document = panel.ownerDocument;
    const heading = document.createElement('h2');
    heading.textContent = 'Notes';
    panel.append(heading);

    for (const annotation of annotations) {
      panel.append(createAnnotationItem(document, annotation, context));
    }

    const form = document.createElement('form');
    const note = document.createElement('textarea');
    note.dataset.annotationNewNote = '';
    note.setAttribute('aria-label', 'New note');
    const save = document.createElement('button');
    save.type = 'submit';
    save.dataset.annotationSave = '';
    save.textContent = 'Save';
    const add = () => {
      const value = note.value.trim();
      if (!value) return;
      void mutate({
        type: 'annotation.add',
        pageUrl: context.url,
        input: { note: value, selector: context.selector, elementContext: context },
      }, context);
    };
    save.addEventListener('click', add);
    form.append(note, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.submitter !== save) add();
    });
    panel.append(form);
  }

  async function mutate(message: AnnotationWriteMessage, context: ElementContext): Promise<void> {
    await persistence.sendAnnotationWrite(message);
    await render(context);
  }

  function createAnnotationItem(
    document: Document,
    annotation: Annotation,
    context: ElementContext,
  ): HTMLElement {
    const item = document.createElement('article');
    item.dataset.annotationId = annotation.id;
    if (annotation.cssEdits && annotation.cssEdits.length > 0) {
      persistence.applyCssEdits(annotation, annotation.cssEdits);
    }
    const note = document.createElement('textarea');
    note.dataset.annotationEditNote = '';
    note.value = annotation.note;
    note.setAttribute('aria-label', `Edit note ${annotation.id}`);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.annotationEdit = '';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      const value = note.value.trim();
      if (!value) return;
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { note: value },
        },
        context,
      );
    });
    const capture = document.createElement('button');
    capture.type = 'button';
    capture.dataset.annotationCaptureScreenshot = '';
    capture.textContent = 'Capture screenshot';
    capture.addEventListener('click', () => {
      void (async () => {
        try {
          const screenshot = await persistence.captureScreenshot(annotation);
          if (!screenshot) return;
          await mutate(
            {
              type: 'annotation.update',
              pageUrl: context.url,
              id: annotation.id,
              changes: { screenshot },
            },
            context,
          );
        } catch {
          // Capture failures are intentionally fail-closed.
        }
      })();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.annotationDelete = '';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      void mutate(
        { type: 'annotation.delete', pageUrl: context.url, id: annotation.id },
        context,
      );
    });
    const reproSteps = document.createElement('textarea');
    reproSteps.dataset.annotationReproSteps = '';
    reproSteps.value = annotation.repro?.steps.join('\n') ?? '';
    reproSteps.setAttribute('aria-label', `Reproduction steps ${annotation.id}`);
    const reproExpected = document.createElement('textarea');
    reproExpected.dataset.annotationReproExpected = '';
    reproExpected.value = annotation.repro?.expected ?? '';
    reproExpected.setAttribute('aria-label', `Expected result ${annotation.id}`);
    const reproActual = document.createElement('textarea');
    reproActual.dataset.annotationReproActual = '';
    reproActual.value = annotation.repro?.actual ?? '';
    reproActual.setAttribute('aria-label', `Actual result ${annotation.id}`);
    const cssDecls = document.createElement('textarea');
    cssDecls.dataset.annotationCssDecls = '';
    cssDecls.value = annotation.cssEdits?.map(({ property, value }) => `${property}: ${value}`).join('\n') ?? '';
    cssDecls.setAttribute('aria-label', `CSS declarations ${annotation.id}`);
    const saveCss = document.createElement('button');
    saveCss.type = 'button';
    saveCss.dataset.annotationCssSave = '';
    saveCss.textContent = 'Save CSS';
    saveCss.addEventListener('click', () => {
      const edits = parseCssEdits(cssDecls.value);
      if (edits.length === 0) return;
      persistence.applyCssEdits(annotation, edits);
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { cssEdits: edits },
        },
        context,
      );
    });
    const clearCss = document.createElement('button');
    clearCss.type = 'button';
    clearCss.dataset.annotationCssClear = '';
    clearCss.textContent = 'Clear tweaks';
    clearCss.addEventListener('click', () => {
      persistence.revertCssEdits(annotation);
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { cssEdits: [] },
        },
        context,
      );
    });
    const saveRepro = document.createElement('button');
    saveRepro.type = 'button';
    saveRepro.dataset.annotationReproSave = '';
    saveRepro.textContent = 'Save repro';
    saveRepro.addEventListener('click', () => {
      const steps = reproSteps.value
        .split(/\r?\n/)
        .map((step) => step.trim())
        .filter(Boolean);
      const expected = reproExpected.value.trim();
      const actual = reproActual.value.trim();
      if (steps.length === 0 && !expected && !actual) return;
      void mutate(
        {
          type: 'annotation.update',
          pageUrl: context.url,
          id: annotation.id,
          changes: { repro: { steps, expected, actual } },
        },
        context,
      );
    });
    item.append(
      note,
      edit,
      capture,
      remove,
      cssDecls,
      saveCss,
      reproSteps,
      reproExpected,
      reproActual,
      saveRepro,
    );
    if (annotation.cssEdits && annotation.cssEdits.length > 0) {
      item.append(clearCss);
      const readout = document.createElement('ul');
      readout.dataset.annotationCss = '';
      for (const { property, value } of annotation.cssEdits) {
        const entry = document.createElement('li');
        entry.textContent = `${property}: ${value}`;
        readout.append(entry);
      }
      item.append(readout);
    }
    if (annotation.repro) {
      const readout = document.createElement('div');
      readout.dataset.annotationRepro = '';
      const stepsList = document.createElement('ol');
      for (const step of annotation.repro.steps) {
        const listItem = document.createElement('li');
        listItem.textContent = step;
        stepsList.append(listItem);
      }
      const expected = document.createElement('p');
      expected.textContent = `Expected: ${annotation.repro.expected}`;
      const actual = document.createElement('p');
      actual.textContent = `Actual: ${annotation.repro.actual}`;
      readout.append(stepsList, expected, actual);
      item.append(readout);
    }
    if (annotation.screenshot) {
      const preview = document.createElement('img');
      preview.dataset.annotationScreenshot = '';
      preview.src = annotation.screenshot;
      preview.alt = 'Annotation screenshot';
      item.append(preview);
    }
    return item;
  }

  function teardown(): void {
    persistence.revertAllCssEdits();
  }

  return { render, teardown };
}

function parseCssEdits(value: string): CssEdit[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator === -1) return [];

    const property = line.slice(0, separator).trim();
    const editValue = line.slice(separator + 1).trim();
    return property && editValue ? [{ property, value: editValue }] : [];
  });
}
