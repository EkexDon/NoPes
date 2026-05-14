import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err));
  
  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle2' });
  console.log('Page loaded');
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
