import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';
import type { AnnotationWriteMessage } from '../annotation-messages';
import { createNotePanelPersistence, type NotePanelPersistence } from './persistence';

export interface NotePanel {
  render(context: ElementContext): Promise<void>;
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
    item.append(note, edit, capture, remove);
    if (annotation.screenshot) {
      const preview = document.createElement('img');
      preview.dataset.annotationScreenshot = '';
      preview.src = annotation.screenshot;
      preview.alt = 'Annotation screenshot';
      item.append(preview);
    }
    return item;
  }

  return { render };
}
