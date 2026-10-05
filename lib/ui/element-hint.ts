export function createElementHint(document: Document, label: string, selector: string): HTMLParagraphElement {
  const hint = document.createElement('p');
  hint.dataset.annotationHint = '';
  hint.title = selector;
  const text = document.createElement('span');
  text.textContent = label;
  text.title = label === selector ? label : `${label}\n${selector}`;
  hint.append(text);
  return hint;
}
