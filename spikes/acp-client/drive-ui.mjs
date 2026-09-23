// Drives ui.html in headless Chrome against a running relay: types a prompt,
// allows the oscine_status permission, denies the Write, waits for turn end, screenshots.
import { createRequire } from 'node:module';
const require = createRequire('~/workspaces/oscine/package.json');
const { chromium } = require('playwright-core');

const URL = process.env.URL || 'http://127.0.0.1:7399/';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
await page.goto(URL);
await page.fill('#q', "Call the oscine_status MCP tool exactly once and summarize it in one sentence. Then create hello.txt in the current directory containing 'hi' with your Write tool. No other tools.");
await page.click('form button');
const decisions = [];
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  if (await page.locator('.meta', { hasText: 'stopReason' }).count()) break;
  const open = page.locator('.perm:not(.done)');
  if (await open.count()) {
    const card = open.first();
    const title = await card.locator('b').innerText();
    const allow = /^mcp__oscine__/.test(title);
    await card.locator(allow ? 'button.allow' : 'button.reject').first().click();
    decisions.push({ title, clicked: allow ? 'allow' : 'reject' });
  }
  await page.waitForTimeout(300);
}
const out = await page.evaluate(() => ({
  tools: [...document.querySelectorAll('.tool')].map((d) => d.innerText.replace(/\s+/g, ' ')),
  perms: [...document.querySelectorAll('.perm')].map((d) => d.innerText.replace(/\s+/g, ' ')),
  agent: [...document.querySelectorAll('.agent')].map((d) => d.innerText).join('\n---\n'),
  end: [...document.querySelectorAll('.meta')].map((d) => d.innerText).filter((t) => t.startsWith('stopReason')),
}));
await page.screenshot({ path: 'evidence/relay-ui.png', fullPage: true });
console.log(JSON.stringify({ decisions, ...out }, null, 2));
await browser.close();
