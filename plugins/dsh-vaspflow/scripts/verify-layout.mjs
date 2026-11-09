/** Real-browser regression against an isolated DSH Web with onboarding dismissed. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

assert.ok(process.env.DSH_TEST_URL, 'Set DSH_TEST_URL to the isolated DSH authentication URL');
const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
assert.ok(executablePath, 'Set BROWSER_EXECUTABLE_PATH to a Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(process.env.DSH_TEST_URL);
  const entry = page.locator('[data-dsh-vaspflow-entry]');
  await entry.waitFor({ state: 'visible', timeout: 45000 });
  const panel = page.locator('[data-dsh-vaspflow-panel]');
  if (!(await panel.isVisible())) await entry.click();
  await panel.waitFor({ state: 'visible' });
  const output = process.env.LAYOUT_SCREENSHOT_DIR ?? fileURLToPath(new URL('../../../output/dsh-upgrade-runtime/layout/', import.meta.url));
  mkdirSync(output, { recursive: true });
  const checkDock = async (label) => {
    const geometry = await panel.evaluate(el => {
      const box = el.getBoundingClientRect();
      const frame = el.parentElement.getBoundingClientRect();
      const center = el.parentElement.querySelector('[class*="centerCol"]').getBoundingClientRect();
      return { panel: { x: box.x, y: box.y, width: box.width, height: box.height }, frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, center: { right: center.right, height: center.height } };
    });
    console.log(label, JSON.stringify(geometry));
    await page.screenshot({ path: resolve(output, label + '.png') });
    assert.ok(Math.abs(geometry.panel.y - geometry.frame.y) < 2, 'panel must stay in the first grid row');
    assert.ok(geometry.panel.height >= geometry.frame.height - 2, 'panel must fill the frame height');
    assert.ok(geometry.panel.x >= geometry.center.right - 2, 'panel must dock to the right of the conversation');
    assert.ok(geometry.panel.x + geometry.panel.width <= geometry.frame.x + geometry.frame.width + 2, 'panel must remain inside the frame');
    return geometry;
  };
  const initial = await checkDock('opened');
  const handle = panel.locator('div[style*="cursor: col-resize"]').first();
  const grip = await handle.boundingBox();
  assert.ok(grip, 'panel resize handle must be visible');
  const gripX = grip.x + grip.width / 2;
  const gripY = grip.y + grip.height / 2;
  await page.mouse.move(gripX, gripY);
  await page.mouse.down();
  await page.mouse.move(gripX - 80, gripY, { steps: 8 });
  await page.waitForFunction(width => document.querySelector('[data-dsh-vaspflow-panel]').getBoundingClientRect().width > width + 30, initial.panel.width);
  await page.mouse.up();
  await checkDock('dragged');
  await entry.click();
  assert.equal(await panel.isVisible(), false);
  await entry.click();
  await checkDock('reopened');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await checkDock('resized');
  console.log('[layout] real DSH docking, drag, close/reopen and viewport resize passed');
} finally { await browser.close(); }
