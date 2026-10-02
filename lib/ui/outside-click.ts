import type { PanelMode } from '../wiring/panel-mode';

export interface OutsideClickOptions {
  win: Window;
  shadowHost: HTMLElement;
  panels: Pick<PanelMode, 'mode' | 'dismiss'>;
  captureActive(): boolean;
}

// A primary click on the page outside the overlay closes the note panel. One pointer gesture takes it: its
// pointerdown, pointerup and click all fall outside, with the note panel open and capture inactive, and the
// click is the pointer's own (detail 0 is a keyboard activation). A drag out of the form, a press released
// over it, a press that never clicks, and the click that selects an element for a note close nothing.
// Drafts are kept by the note panel.
export function watchOutsideClick(options: OutsideClickOptions): () => void {
  const { win, shadowHost, panels, captureActive } = options;
  const outside = (event: MouseEvent) => event.isTrusted && event.button === 0 && !event.composedPath().includes(shadowHost);
  const armed = () => panels.mode() === 'note' && !captureActive();
  let pending = false;
  const onPointerDown = (event: PointerEvent) => {
    pending = outside(event) && armed();
  };
  const onPointerUp = (event: PointerEvent) => {
    pending = pending && outside(event) && armed();
  };
  const onClick = (event: MouseEvent) => {
    const started = pending;
    pending = false;
    if (started && event.detail !== 0 && outside(event) && armed()) panels.dismiss();
  };
  win.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('pointerup', onPointerUp, true);
  win.addEventListener('click', onClick, true);
  return () => {
    win.removeEventListener('pointerdown', onPointerDown, true);
    win.removeEventListener('pointerup', onPointerUp, true);
    win.removeEventListener('click', onClick, true);
  };
}
