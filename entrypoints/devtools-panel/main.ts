import { browser } from 'wxt/browser';
import { listAnnotations } from '../../lib/annotation-storage';
import {
  buildAnnotationRows,
  buildInspectExpression,
  type AnnotationRow,
} from '../../lib/devtools/devtools';

const status = document.querySelector<HTMLParagraphElement>('#status');
const annotations = document.querySelector<HTMLUListElement>('#annotations');

async function getInspectedPageUrl(): Promise<string | null> {
  try {
    const url = await browser.devtools.inspectedWindow.eval<string>('location.href');
    return typeof url === 'string' && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

function renderRows(rows: AnnotationRow[]): void {
  if (!status || !annotations) return;

  annotations.replaceChildren(
    ...rows.map(({ note, selector }) => {
      const item = document.createElement('li');
      const noteText = document.createElement('strong');
      const selectorText = document.createElement('code');
      const inspectButton = document.createElement('button');

      noteText.textContent = note;
      selectorText.textContent = selector;
      inspectButton.type = 'button';
      inspectButton.textContent = 'Inspect element';
      inspectButton.addEventListener('click', () => {
        void browser.devtools.inspectedWindow.eval(buildInspectExpression(selector));
      });

      item.append(noteText, document.createTextNode(' '), selectorText, document.createTextNode(' '), inspectButton);
      return item;
    }),
  );
  status.textContent = rows.length === 0 ? 'No annotations for this page.' : '';
}

async function loadAnnotations(): Promise<void> {
  if (!status) return;

  const pageUrl = await getInspectedPageUrl();
  if (!pageUrl) {
    status.textContent = 'Unable to determine the inspected page.';
    return;
  }

  try {
    renderRows(buildAnnotationRows(await listAnnotations(pageUrl)));
  } catch {
    status.textContent = 'Unable to load annotations.';
  }
}

void loadAnnotations();
