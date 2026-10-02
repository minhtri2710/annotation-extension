import type { PanelMode } from '../wiring/panel-mode';

export interface OutsideClickOptions {
  win: Window;
  shadowHost: HTMLElement;
  panels: Pick<PanelMode, 'mode' | 'dismiss'>;
  captureActive(): boolean;
}

// A primary click on the page outside the overlay closes the note panel. The gesture must start and end
// outside with the note panel open and capture inactive, so a drag out of the form or the click that selects
// an element for a note closes nothing. Drafts are kept by the note panel.
export function watchOutsideClick(options: OutsideClickOptions): () => void {
  const { win, shadowHost, panels, captureActive } = options;
  const outside = (event: MouseEvent) => event.isTrusted && event.button === 0 && !event.composedPath().includes(shadowHost);
  const armed = () => panels.mode() === 'note' && !captureActive();
  let pending = false;
  const onPointerDown = (event: PointerEvent) => {
    pending = outside(event) && armed();
  };
  const onClick = (event: MouseEvent) => {
    const started = pending;
    pending = false;
    if (started && outside(event) && armed()) panels.dismiss();
  };
  win.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('click', onClick, true);
  return () => {
    win.removeEventListener('pointerdown', onPointerDown, true);
    win.removeEventListener('click', onClick, true);
  };
}
