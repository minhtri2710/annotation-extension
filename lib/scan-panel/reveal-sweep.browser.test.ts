import { afterEach, describe, expect, it } from 'vitest';
import { collectFindings, createScanContext } from '../lint/engine';
import { DEEP_SCAN_RULES } from '../lint/rules';
import { revealSweep } from './reveal-sweep';

const SECTIONS = 60;
const tallRevealPage = `<!doctype html><html lang="en"><head><style>body{margin:0;font:18px/1.6 system-ui}section{min-height:90vh;max-width:65ch;margin:0 auto;padding:24px}.reveal{opacity:0}.reveal.in{opacity:1}</style></head><body>${
  Array.from({ length: SECTIONS }, (_, k) => `<section class="reveal"><h2>Chapter ${k + 1}</h2><p>Chapter ${k + 1} tells part of the story with enough words to count as real body text for the reveal rule measurement.</p></section>`).join('')
}<script>const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}},{threshold:0.1});document.querySelectorAll('.reveal').forEach(el=>io.observe(el));</script></body></html>`;

let frame: HTMLIFrameElement | undefined;

async function load(): Promise<Window> {
  frame = document.createElement('iframe');
  frame.style.cssText = 'width:1280px;height:800px;border:0;position:fixed;top:0;left:0';
  document.body.append(frame);
  await new Promise<void>((resolve) => {
    frame!.onload = () => resolve();
    frame!.srcdoc = tallRevealPage;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  return frame.contentWindow!;
}

afterEach(() => {
  frame?.remove();
  frame = undefined;
});

describe('revealSweep in a real browser', () => {
  it('reveals every section of a tall page, restores the position, and leaves no hidden-at-rest finding', async () => {
    const win = await load();
    expect(win.document.documentElement.scrollHeight).toBeGreaterThan(50 * 0.7 * win.innerHeight);
    win.scrollTo({ top: 1234, left: 0, behavior: 'instant' });
    await revealSweep(win, new AbortController().signal);
    expect(win.document.querySelectorAll('.reveal.in')).toHaveLength(SECTIONS);
    expect(win.scrollY).toBe(1234);
    const findings = await collectFindings([...DEEP_SCAN_RULES], createScanContext(win), new AbortController().signal);
    expect(findings).toEqual([]);
  }, 30_000);

  it('stops at the next step on abort and restores the exact position', async () => {
    const win = await load();
    win.scrollTo({ top: 1234, left: 0, behavior: 'instant' });
    const controller = new AbortController();
    const outcome = revealSweep(win, controller.signal).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const reason = new Error('cancel');
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(win.scrollY).toBe(1234);
    expect(win.document.querySelectorAll('.reveal.in').length).toBeLessThan(SECTIONS);
  }, 30_000);
});
