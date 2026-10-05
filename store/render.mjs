import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium, firefox } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STORE = path.join(ROOT, 'store');
const DEMO_ORIGIN = 'https://annotation-demo.test';
const DEADLINE_MS = 540_000;
const STEP_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 1280, height: 800 };
const NOTES = [
  { target: '#hero-title', dx: 0.5, text: 'Shorten the headline so it fits on two lines.' },
  { target: '#cta', dx: 0.5, text: 'Use the same label as the pricing page.' },
  { target: '.perk h3', dx: 0.5, text: 'Add an icon above each benefit title.' },
];
const DRAFT = { target: '.slot >> nth=1', dx: 0, text: 'Show the time zone next to each time.' };
const ICON_SIZE = 96;
const ICON_OFFSET = 16;
const TILE = { width: 440, height: 280 };
const TAGLINE = 'Pin notes to any element. Scan pages for design issues.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const written = [];
const cleanups = [];

async function cleanup() {
  while (cleanups.length) {
    const fn = cleanups.pop();
    await Promise.race([Promise.resolve().then(fn).catch((e) => console.error(`cleanup: ${e.message}`)), sleep(CLOSE_TIMEOUT_MS)]);
  }
}

const deadline = setTimeout(async () => {
  console.error(`render: hard deadline of ${DEADLINE_MS} ms reached`);
  await cleanup();
  process.exit(1);
}, DEADLINE_MS);

function fail(message) {
  throw new Error(message);
}

function readBuild(dir) {
  const manifestPath = path.join(ROOT, '.output', dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`${manifestPath} is missing: run pnpm build and pnpm build:firefox first`);
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function checkBuilds() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const dir of ['chrome-mv3', 'firefox-mv3']) {
    const built = readBuild(dir).version;
    if (built !== version) fail(`.output/${dir} is version ${built}, package.json is ${version}: rebuild first`);
  }
}

function prepareBuild(dir, tmp) {
  const copy = path.join(tmp, 'extension');
  fs.cpSync(path.join(ROOT, '.output', dir), copy, { recursive: true });
  const file = path.join(copy, 'content-scripts', 'content.js');
  const closed = 'name:`annotation-extension-root`,mode:`closed`';
  const js = fs.readFileSync(file, 'utf8');
  const matches = js.split(closed).length - 1;
  if (matches !== 1) fail(`${dir}: expected one closed shadow root, found ${matches}`);
  let patched = js.replace(closed, closed.replace('closed', 'open'));
  if (dir === 'firefox-mv3') {
    // Playwright's Firefox cannot attach to moz-extension pages, so the popup cannot enable the toolbar there: the content script's toolbar read returns on.
    const read = /async function \w+\(e\)\{return\(await \w+\(e===void 0\?\{type:\w+\}/g;
    const reads = patched.match(read)?.length ?? 0;
    if (reads !== 1) fail(`${dir}: expected one toolbar read, found ${reads}`);
    patched = patched.replace(read, (m) => m.replace('{return(', '{return!0;return('));
  }
  fs.writeFileSync(file, patched);
  return copy;
}

function makeTemp(engine) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `annotation-store-${engine}-`));
  console.log(`temp profile ${tmp}`);
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return tmp;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function installTemporaryAddon(port, addonPath, geckoId) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('add-on install timed out')); }, STEP_TIMEOUT_MS);
    const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
    const ok = settle(resolve);
    const bad = settle(reject);
    let buf = '';
    let prefs;
    const send = (message) => { const json = JSON.stringify(message); sock.write(`${Buffer.byteLength(json)}:${json}`); };
    sock.setEncoding('utf8');
    sock.on('error', bad);
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        const i = buf.indexOf(':');
        if (i < 0) return;
        const n = Number(buf.slice(0, i));
        if (buf.length < i + 1 + n) return;
        const msg = JSON.parse(buf.slice(i + 1, i + 1 + n));
        buf = buf.slice(i + 1 + n);
        if (msg.from === 'root' && msg.applicationType) send({ to: 'root', type: 'getRoot' });
        else if (msg.addonsActor) { prefs = msg.preferenceActor; send({ to: msg.addonsActor, type: 'installTemporaryAddon', addonPath }); }
        else if (msg.error) { sock.end(); bad(new Error(JSON.stringify(msg))); }
        else if (msg.addon) send({ to: prefs, type: 'getCharPref', value: 'extensions.webextensions.uuids' });
        else if (typeof msg.value === 'string') { sock.end(); ok(JSON.parse(msg.value)[geckoId]); }
      }
    });
  });
}

class Rdp {
  constructor(sock) {
    this.sock = sock;
    this.buf = '';
    this.inbox = [];
    this.waiters = [];
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      this.buf += chunk;
      for (;;) {
        const i = this.buf.indexOf(':');
        if (i < 0) return;
        const n = Number(this.buf.slice(0, i));
        if (this.buf.length < i + 1 + n) return;
        this.inbox.push(JSON.parse(this.buf.slice(i + 1, i + 1 + n)));
        this.buf = this.buf.slice(i + 1 + n);
        this.flush();
      }
    });
    sock.on('error', (e) => this.waiters.splice(0).forEach((w) => { clearTimeout(w.timer); w.reject(e); }));
  }

  static async connect(port) {
    const rdp = new Rdp(net.connect(port, '127.0.0.1'));
    await rdp.wait((m) => m.from === 'root' && m.applicationType, 'hello');
    return rdp;
  }

  flush() {
    for (const w of [...this.waiters]) {
      const i = this.inbox.findIndex(w.match);
      if (i < 0) continue;
      clearTimeout(w.timer);
      this.waiters.splice(this.waiters.indexOf(w), 1);
      w.resolve(this.inbox.splice(i, 1)[0]);
    }
  }

  wait(match, label) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`RDP ${label} timed out`));
      }, STEP_TIMEOUT_MS);
      this.waiters.push(w);
      this.flush();
    });
  }

  async request(to, message) {
    const json = JSON.stringify({ to, ...message });
    this.sock.write(`${Buffer.byteLength(json)}:${json}`);
    const reply = await this.wait((m) => m.from === to && !m.type, `${to} ${message.type}`);
    if (reply.error) fail(`RDP ${message.type}: ${JSON.stringify(reply)}`);
    return reply;
  }

  async evaluatePlain(consoleActor, text) {
    const { resultID } = await this.request(consoleActor, { type: 'evaluateJSAsync', text });
    const done = await this.wait((m) => m.type === 'evaluationResult' && m.resultID === resultID, 'evaluation');
    if (done.exception) fail(`RDP evaluation threw: ${done.exceptionMessage ?? JSON.stringify(done.exception)}`);
    return done.result;
  }

  async evaluate(consoleActor, body) {
    await this.evaluatePlain(
      consoleActor,
      `globalThis.rdpResult = undefined; (async () => { ${body} })().then((v) => { globalThis.rdpResult = JSON.stringify({ v }); }, (e) => { globalThis.rdpResult = JSON.stringify({ e: String(e) }); }); 0`,
    );
    for (const end = Date.now() + STEP_TIMEOUT_MS; Date.now() < end; await sleep(100)) {
      const raw = await this.evaluatePlain(consoleActor, 'globalThis.rdpResult ?? ""');
      if (!raw) continue;
      const result = JSON.parse(raw);
      if ('e' in result) fail(`RDP evaluation threw: ${result.e}`);
      return result.v;
    }
    return fail('RDP evaluation timed out');
  }

  async parentConsole() {
    const { processDescriptor } = await this.request('root', { type: 'getProcess', id: 0 });
    const { process } = await this.request(processDescriptor.actor, { type: 'getTarget' });
    return process.consoleActor;
  }

  close() {
    this.sock.destroy();
  }
}

const popupTabs = (pageUrl) => {
  if (!/-extension:$/.test(location.protocol)) return;
  window.close = () => {};
  for (const api of [globalThis.browser?.tabs, globalThis.chrome?.tabs]) {
    if (!api) continue;
    const query = api.query.bind(api);
    api.query = async (q) => {
      if (!q || !q.active) return query(q);
      const self = await api.getCurrent();
      const others = (await query({})).filter((t) => t.id !== self?.id).sort((a, b) => b.id - a.id);
      return others.slice(0, 1).map((t) => ({ ...t, active: true, url: pageUrl }));
    };
  }
};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

function toRgb(png) {
  if (png[25] === 2) return png;
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) fail('screenshot is not an 8-bit non-interlaced RGBA PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const data = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? px[y * stride + x - 4] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      px[y * stride + x] = (data[y * (stride + 1) + 1 + x] + [0, left, up, (left + up) >> 1, paeth][filter]) & 0xff;
    }
  }
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[y * stride + x * 4 + 3] !== 255) fail('screenshot has a transparent pixel');
      px.copy(rows, y * (width * 3 + 1) + 1 + x * 3, y * stride + x * 4, y * stride + x * 4 + 3);
    }
  }
  const ihdr = Buffer.from(png.subarray(16, 29));
  ihdr[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function save(dir, name, png) {
  const file = path.join(STORE, dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  written.push(file);
  console.log(`${file} ${png.length} bytes`);
}

const shoot = (page) => page.screenshot({ type: 'png', caret: 'hide', animations: 'disabled' });

async function renderCards(browser) {
  const svg = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 128, height: 128 } });
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;position:absolute;left:${ICON_OFFSET}px;top:${ICON_OFFSET}px;width:${ICON_SIZE}px;height:${ICON_SIZE}px}</style>${svg}`,
  );
  save('chrome', 'icon-128.png', await page.screenshot({ type: 'png', omitBackground: true }));
  await page.setViewportSize(TILE);
  await page.setContent(
    `<style>html,body{margin:0}body{width:${TILE.width}px;height:${TILE.height}px;box-sizing:border-box;padding:32px;background:#f6f8fa;color:#1b2430;font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}svg{display:block;width:72px;height:72px;margin-bottom:24px}h1{margin:0 0 8px;font-size:28px;line-height:1.15}p{margin:0;font-size:16px;color:#3b4655}</style>${svg}<h1>Annotation Extension</h1><p>${TAGLINE.replace('. ', '.<br>')}</p>`,
  );
  const perLine = await page.evaluate(() => {
    const counts = new Map();
    const walker = document.createTreeWalker(document.querySelector('p'), NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode()); ) {
      for (const word of node.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        const top = Math.round(range.getBoundingClientRect().top);
        counts.set(top, (counts.get(top) ?? 0) + 1);
      }
    }
    return [...counts.values()];
  });
  if (perLine.some((words) => words < 2)) fail(`promo tile tagline has a line with one word: words per line ${perLine.join(', ')}`);
  save('chrome', 'promo-440x280.png', toRgb(await shoot(page)));
  await page.close();
}

async function firefoxPopupPng(rdp, parent, base, tmp) {
  const system = 'Services.scriptSecurityManager.getSystemPrincipal()';
  await rdp.evaluate(
    parent,
    `const win = Services.wm.getMostRecentWindow('navigator:browser'); globalThis.popupTab = win.gBrowser.addTab(${JSON.stringify(`${base}/popup.html`)}, { triggeringPrincipal: ${system} }); 'added'`,
  );
  const browserId = await rdp.evaluate(parent, 'return globalThis.popupTab.linkedBrowser.browserId');
  const { tab } = await rdp.request('root', { type: 'getTab', browserId });
  const target = await rdp.request(tab.actor, { type: 'getTarget' });
  const content = (target.frame ?? target.tab ?? target).consoleActor;
  if (!content) fail(`popup tab target has no console: ${JSON.stringify(target)}`);
  const inPopup = (body) => rdp.evaluate(content, body);
  const settled = (selector) =>
    `return await new Promise((resolve) => { const start = Date.now(); const check = () => { const found = !!document.querySelector(${JSON.stringify(selector)}); if (found || Date.now() - start > 10000) resolve(found); else setTimeout(check, 100); }; check(); })`;
  if ((await inPopup(settled('#toolbar-toggle:not([disabled])'))) !== true) fail('firefox popup did not settle');
  await inPopup(`document.querySelector('#toolbar-toggle').click(); await new Promise((resolve) => setTimeout(resolve, 1000)); return 'clicked'`);
  await rdp.evaluatePlain(content, 'location.reload(); 0');
  await sleep(1000);
  if ((await inPopup(settled('#toolbar-toggle[aria-checked="true"]'))) !== true) fail('firefox popup switch is not on after the click');
  await inPopup('await document.fonts.ready; return 1');
  const size = await inPopup('return { width: document.body.offsetWidth, height: document.querySelector("main").offsetHeight, inner: [innerWidth, innerHeight] }');
  console.log(`firefox: popup size ${JSON.stringify(size)}`);
  const file = path.join(tmp, 'popup.png');
  await rdp.evaluate(
    parent,
    `const win = Services.wm.getMostRecentWindow('navigator:browser'); win.gBrowser.selectedTab = globalThis.popupTab; await new Promise((resolve) => win.setTimeout(resolve, 800));
     const snapshot = await globalThis.popupTab.linkedBrowser.browsingContext.currentWindowGlobal.drawSnapshot(new win.DOMRect(0, 0, ${size.width}, ${size.height}), 1, 'white');
     const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'); canvas.width = ${size.width}; canvas.height = ${size.height};
     canvas.getContext('2d').drawImage(snapshot, 0, 0);
     const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
     await IOUtils.write(${JSON.stringify(file)}, new Uint8Array(await blob.arrayBuffer()));
     win.gBrowser.removeTab(globalThis.popupTab); return 'saved'`,
  );
  return fs.readFileSync(file);
}

async function waitForCount(locator, count) {
  await locator.nth(count - 1).waitFor();
  if ((await locator.count()) !== count) fail(`expected ${count} matches, found ${await locator.count()}`);
}

async function clickAt(page, locator, dx) {
  const box = await locator.boundingBox();
  if (!box) fail('target has no box');
  await page.mouse.click(box.x + (dx === 0 ? 6 : box.width * dx), box.y + box.height / 2);
}

async function renderEngine(engine) {
  const isChromium = engine === 'chromium';
  const dir = isChromium ? 'chrome' : 'firefox';
  const tmp = makeTemp(engine);
  const extension = prepareBuild(`${dir}-mv3`, tmp);
  const profile = path.join(tmp, 'profile');
  const options = { headless: true, viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' };
  let ctx;
  let base;
  let debugPort;
  let rdp;
  let parent;
  if (isChromium) {
    ctx = await chromium.launchPersistentContext(profile, {
      ...options,
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
  } else {
    debugPort = await freePort();
    ctx = await firefox.launchPersistentContext(profile, {
      ...options,
      args: ['-start-debugger-server', String(debugPort)],
      firefoxUserPrefs: { 'devtools.debugger.remote-enabled': true, 'devtools.chrome.enabled': true, 'devtools.debugger.prompt-connection': false },
    });
  }
  cleanups.push(() => ctx.close());
  if (isChromium) {
    const [worker = await ctx.waitForEvent('serviceworker', { timeout: STEP_TIMEOUT_MS })] = ctx.serviceWorkers();
    base = `chrome-extension://${new URL(worker.url()).host}`;
  } else {
    const geckoId = readBuild('firefox-mv3').browser_specific_settings.gecko.id;
    const uuid = await installTemporaryAddon(debugPort, extension, geckoId);
    base = `moz-extension://${uuid}`;
    rdp = await Rdp.connect(debugPort);
    cleanups.push(() => rdp.close());
    parent = await rdp.parentConsole();
  }
  console.log(`${engine}: extension ${base}`);

  const demo = fs.readFileSync(path.join(STORE, 'demo.html'));
  await ctx.route(`${DEMO_ORIGIN}/**`, (route) =>
    route.request().url() === `${DEMO_ORIGIN}/`
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: demo })
      : route.fulfill({ status: 204 }),
  );

  const page = await ctx.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  await page.goto(`${DEMO_ORIGIN}/`);

  await ctx.addInitScript(popupTabs, `${DEMO_ORIGIN}/`);
  const openPopup = async () => {
    const popup = await ctx.newPage();
    popup.setDefaultTimeout(STEP_TIMEOUT_MS);
    await popup.goto(`${base}/popup.html`);
    await popup.locator('#toggle:not([disabled])').waitFor();
    return popup;
  };

  const toolbar = page.locator('[data-annotation-mount="toolbar"]');
  const panel = page.locator('[data-annotation-mount="panel"]');
  let popup;
  if (isChromium) {
    popup = await openPopup();
    await popup.locator('#toggle').click();
    await page.bringToFront();
  }
  await toolbar.waitFor({ state: 'visible' });
  const annotate = toolbar.locator('[data-annotation-toggle]');
  if (isChromium) await annotate.filter({ hasText: 'Stop annotating' }).click();
  // The first frame drawn is the one with the pointer where the last click left it; without it the button that click hovered rendered in one of two states per run after the pointer left.
  const calm = async () => {
    await shoot(page);
    await page.mouse.move(4, 4);
    await page.evaluate(() => document.fonts.ready);
    await sleep(500);
  };
  const shot = async (slug) => {
    await calm();
    const busy = await page.evaluate(() => {
      const root = document.querySelector('annotation-extension-root').shadowRoot;
      return { hovered: root.querySelectorAll(':hover').length, animations: root.getAnimations().length };
    });
    if (busy.hovered || busy.animations) fail(`${engine}: overlay not settled before shot ${slug}: ${busy.hovered} hovered, ${busy.animations} running animations`);
    const png = toRgb(await shoot(page));
    save(dir, `screenshot-${slug}.png`, png);
  };

  await toolbar.getByRole('button', { name: 'Scan' }).click();
  await panel.locator('[data-annotation-scan-summary]').waitFor();
  await page.locator('annotation-extension-root').waitFor({ state: 'attached' });
  const boxes = await page.evaluate(() =>
    [...document.querySelector('annotation-extension-root').shadowRoot.querySelectorAll('[data-annotation-scan-outline]')].map((b) => b.getAttribute('data-annotation-scan-outline')),
  );
  console.log(`${engine}: scan boxes ${JSON.stringify(boxes)}`);
  console.log(`${engine}: scan panel ${(await panel.innerText()).replace(/\n+/g, ' | ')}`);
  if (boxes.length < 3 || boxes.length > 6) fail(`${engine}: scan reported ${boxes.length} findings, expected 3 to 6`);
  if (new Set(boxes).size < 2) fail(`${engine}: scan reported one severity only`);
  await shot('3-scan');
  await toolbar.getByRole('button', { name: 'Scan' }).click();

  const pins = page.locator('.annotation-pin');
  const startAnnotating = async () => {
    if ((await annotate.getAttribute('aria-pressed')) !== 'true') await annotate.click();
  };
  for (const [index, note] of NOTES.entries()) {
    await startAnnotating();
    await clickAt(page, page.locator(note.target).first(), note.dx);
    await panel.locator('textarea:visible').fill(note.text);
    await panel.getByRole('button', { name: /^Add note$/ }).last().click();
    await waitForCount(pins, index + 1);
    await panel.getByRole('button', { name: 'Close' }).click();
  }
  if ((await annotate.getAttribute('aria-pressed')) === 'true') await annotate.click();
  await shot('1-pins');

  await startAnnotating();
  await clickAt(page, page.locator(DRAFT.target), DRAFT.dx);
  await panel.locator('textarea:visible').fill(DRAFT.text);
  await shot('2-note');
  await panel.getByRole('button', { name: 'Close' }).click();

  await toolbar.getByRole('button', { name: 'View all' }).click();
  await panel.locator('[data-annotation-export]').waitFor();
  await shot('4-list');
  await toolbar.getByRole('button', { name: 'View all' }).click();

  let popupPng;
  if (isChromium) {
    await popup.bringToFront();
    await popup.setViewportSize({ width: 352, height: 100 });
    await popup.reload();
    await popup.locator('#toolbar-toggle:not([disabled])').click();
    await popup.reload();
    await popup.locator('#toolbar-toggle[aria-checked="true"]').waitFor();
    await popup.evaluate(() => document.fonts.ready);
    const size = await popup.evaluate(() => ({ width: document.body.offsetWidth, height: document.querySelector('main').offsetHeight }));
    await popup.setViewportSize(size);
    await sleep(300);
    popupPng = await popup.screenshot({ type: 'png', caret: 'hide', animations: 'disabled' });
  } else {
    popupPng = await firefoxPopupPng(rdp, parent, base, tmp);
  }
  await page.bringToFront();
  await calm();
  const pagePng = await shoot(page);
  const compose = await ctx.newPage();
  compose.setDefaultTimeout(STEP_TIMEOUT_MS);
  await compose.setViewportSize(VIEWPORT);
  const uri = (png) => `data:image/png;base64,${png.toString('base64')}`;
  await compose.setContent(
    `<style>html,body{margin:0}body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;position:relative;overflow:hidden}img{display:block;position:absolute}.popup{top:12px;right:24px;border:1px solid #c3cad4;box-shadow:0 12px 32px rgba(0,0,0,0.25)}</style><img src="${uri(pagePng)}"><img class="popup" src="${uri(popupPng)}">`,
  );
  await compose.waitForFunction(() => [...document.images].every((img) => img.complete));
  save(dir, 'screenshot-5-popup.png', toRgb(await shoot(compose)));
  await ctx.close();
}

try {
  checkBuilds();
  const browser = await chromium.launch();
  cleanups.push(() => browser.close());
  await renderCards(browser);
  await browser.close();
  await renderEngine('chromium');
  await renderEngine('firefox');
  console.log(`rendered ${written.length} files`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await cleanup();
}
