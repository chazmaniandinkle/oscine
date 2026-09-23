const { chromium } = await import('/Users/slowbro/workspaces/oscine/node_modules/playwright-core/index.mjs');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const reveals = [];
page.on('request', r => { if (r.url().endsWith('/reveal')) reveals.push(r.postData()); });
await page.goto('http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json');
await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(800);
// File menu item
await page.getByRole('button', { name: 'File', exact: true }).click();
const items = await page.locator('.menu .menu-item, .menu button, [role=menuitem]').allInnerTexts().catch(() => []);
console.log('File menu:', items.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
await page.getByText('Show in Finder', { exact: false }).click();
await page.waitForTimeout(600);
const toast1 = await page.locator('.toast').last().innerText().catch(() => '(no toast)');
// Keyboard shortcut
await page.locator('body').click({ position: { x: 700, y: 600 } }).catch(() => {});
await page.keyboard.press('Meta+Shift+KeyR');
await page.waitForTimeout(600);
console.log('reveal requests:', reveals.length, reveals.map(b => JSON.parse(b).path));
console.log('toast:', toast1);
console.log('keymap label:', await page.evaluate(async () => (await import('/src/core/keymap.js')).keymap.label('project.reveal')));
console.log('page errors:', errs.length, errs.slice(0, 2));
await browser.close();
