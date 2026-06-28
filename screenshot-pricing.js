const { chromium } = require('playwright');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

(async () => {
  const server = exec('bun run dev', { cwd: '/dev-server' });
  await new Promise(r => setTimeout(r, 8000));
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://localhost:3000/pricing', { waitUntil: 'networkidle' });
    await page.screenshot({ path: `/mnt/documents/pricing-${width}.png`, fullPage: true });
  }
  
  await browser.close();
  server.kill();
  console.log('Screenshots saved');
})();
