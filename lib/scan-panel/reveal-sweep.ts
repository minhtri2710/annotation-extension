const MIN_STEP_PX = 200;
const STEP_VIEWPORT_RATIO = 0.7;
const STEP_SETTLE_MS = 40;
const FINAL_SETTLE_MS = 700;

// Scrolls top to bottom so on-scroll reveal handlers run, then restores the user's position and settles.
export async function revealSweep(win: Window, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const { scrollX, scrollY } = win;
  try {
    const step = Math.max(MIN_STEP_PX, Math.floor(win.innerHeight * STEP_VIEWPORT_RATIO));
    // Measured once, so a page that grows during the sweep (infinite scroll) cannot extend it.
    const max = Math.max(win.document.documentElement.scrollHeight || 0, win.document.body?.scrollHeight || 0);
    for (let y = 0; y <= max; y += step) {
      win.scrollTo({ top: y, left: 0, behavior: 'instant' });
      await settle(win, STEP_SETTLE_MS, signal, true);
    }
  } finally {
    win.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
  }
  await settle(win, FINAL_SETTLE_MS, signal, false);
}

function settle(win: Window, ms: number, signal: AbortSignal, afterFrame: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (frame !== undefined) win.cancelAnimationFrame(frame);
      clearTimeout(timer);
      reject(signal.reason);
    };
    const wait = () => {
      frame = undefined;
      timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (afterFrame) frame = win.requestAnimationFrame(wait);
    else wait();
  });
}
