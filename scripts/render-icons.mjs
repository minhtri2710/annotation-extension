// Run: node scripts/render-icons.mjs (renders assets/icon.svg to public/icon/{16,32,48,128}.png)
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SIZES = [16, 32, 48, 128];
const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const outDir = fileURLToPath(new URL('../public/icon/', import.meta.url));

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const path = `${outDir}${size}.png`;
    await page.screenshot({ path, omitBackground: true });
    console.log(`${path} ${statSync(path).size} bytes`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
