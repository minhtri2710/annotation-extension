// The muted one-line label of an annotated element. The line is cut with an ellipsis, so its full text
// (and the selector, when the label is not the selector) is the title of the text itself; the line
// keeps the selector as its own title.
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
