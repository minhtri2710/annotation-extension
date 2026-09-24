import type { AnnotationList } from '../annotation-list/annotation-list';
import type { ElementContext } from '../capture/context';
import type { NotePanel } from '../notes/note-panel';
import type { ScanPanel } from '../scan-panel/scan-panel';
import type { PanelAnchor } from '../ui/shell';

const PANEL_LABELS = { note: 'Annotation note', list: 'Annotations on this page', scan: 'Page scan' } as const;

type PanelModeName = 'none' | keyof typeof PANEL_LABELS;

export interface PanelModeOptions {
  panel: HTMLElement;
  overlayRoot: Document | ShadowRoot;
  anchor: Pick<PanelAnchor, 'place' | 'clear'>;
  anchorToToolbar: () => { x: number; y: number; width: number; height: number };
  notePanel: Pick<NotePanel, 'render' | 'clear'>;
  scanPanel: Pick<ScanPanel, 'render' | 'clear'>;
  // The route watch replaces the list, so it is read at each transition.
  annotationList: () => Pick<AnnotationList, 'render' | 'clear'>;
  listToggle: HTMLElement;
  scanToggle: HTMLElement;
}

export interface PanelMode {
  mode(): PanelModeName;
  opener(): HTMLElement | undefined;
  close(): void;
  toggle(mode: 'list' | 'scan'): void;
  showNote(context: ElementContext, opener: HTMLElement | undefined, seed?: string): void;
}

export function createPanelMode(options: PanelModeOptions): PanelMode {
  const { panel, overlayRoot, anchor, anchorToToolbar, notePanel, scanPanel, listToggle, scanToggle } = options;
  let panelMode: PanelModeName = 'none';
  let panelOpener: HTMLElement | undefined;
  let renderSequence = 0;

  const resetPanel = () => {
    if (panelMode === 'note') notePanel.clear();
    if (panelMode === 'list') options.annotationList().clear();
    if (panelMode === 'scan') scanPanel.clear();
    listToggle.setAttribute('aria-expanded', 'false');
    scanToggle.setAttribute('aria-expanded', 'false');
    panel.removeAttribute('aria-label');
    anchor.clear();
    panelMode = 'none';
    panelOpener = undefined;
  };
  const setPanelMode = (mode: keyof typeof PANEL_LABELS, opener: HTMLElement | undefined) => {
    panelMode = mode;
    panelOpener = opener;
    panel.setAttribute('aria-label', PANEL_LABELS[mode]);
  };
  // Focus returns to the opener only if it was inside the panel; focus elsewhere is left alone.
  const close = () => {
    const focusWasInPanel = panel.contains(overlayRoot.activeElement);
    const opener = panelOpener;
    resetPanel();
    if (focusWasInPanel && opener?.isConnected) opener.focus();
  };
  const toggle = (mode: 'list' | 'scan') => {
    if (panelMode === mode) {
      close();
      return;
    }
    resetPanel();
    const modeToggle = mode === 'list' ? listToggle : scanToggle;
    setPanelMode(mode, modeToggle);
    const sequence = ++renderSequence;
    modeToggle.setAttribute('aria-expanded', 'true');
    void (mode === 'list' ? options.annotationList().render() : scanPanel.render()).then(() => {
      if (sequence !== renderSequence || panelMode !== mode) return;
      anchor.place(anchorToToolbar);
    });
  };
  const showNote = (context: ElementContext, opener: HTMLElement | undefined, seed?: string) => {
    resetPanel();
    setPanelMode('note', opener);
    const sequence = ++renderSequence;
    void notePanel.render(context, seed).then(() => {
      if (sequence !== renderSequence || panelMode !== 'note') return;
      anchor.place(() => context.boundingBox);
    });
  };

  return {
    mode: () => panelMode,
    opener: () => panelOpener,
    close,
    toggle,
    showNote,
  };
}
