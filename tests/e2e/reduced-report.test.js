const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../server.js');
const { createFixture, deal } = require('../support/crm-fixture.cjs');

let distPath, server, url;
beforeAll(async () => {
  distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'report-reduced-build-'));
  execFileSync(process.execPath, [
    path.resolve(__dirname, '../../node_modules/vite/bin/vite.js'), 'build', '--mode', 'reduced', '--outDir', distPath, '--emptyOutDir',
  ]);
  server = createServer({ ...createFixture({ items: [
    deal(1, { ufCrmArea: '50' }), deal(2, { ufCrmArea: '70', ufCrmRooms: 5 }), deal(3, { ufCrmProperty: '72' }),
  ] }), distPath });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (distPath) fs.rmSync(distPath, { recursive: true, force: true });
});

test.each([375, 640, 1024, 1440])('reduced report keeps two sections and their lists at %i px', async width => {
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url())));
  await page.setViewportSize({ width, height: 1000 });
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00Z'));
  const lead = { id: 1, date: '2026-11-10', customerName: 'Example Person', stageName: 'Նոր լիդ',
    url: 'https://portal.example/crm/lead/details/1/' };
  await page.route('**/api/toon-expo?*', route => route.fulfill({ json: {
    snapshotId: 'reduced-expo', leads: [lead], deals: [], directDeals: [],
  } }));

  await page.goto(`${url}/#parking`);
  const count = page.getByTestId('statistics-count');
  await count.waitFor();
  expect(await count.innerText()).toBe('2');
  const header = page.locator('.report-header');
  const headerSize = async content => {
    const { y, height } = await header.boundingBox();
    const next = await page.locator(content).boundingBox();
    return { height, gap: next.y - y - height };
  };
  const apartmentHeader = await headerSize('.report-top-panels');
  expect(await page.locator('#amount-min, #amount-max, .property-stages, .deals-histogram').count()).toBe(0);
  const pie = page.locator('.statistics-pie svg');
  await pie.waitFor();
  await page.locator('.statistics-trigger').click();
  expect(await page.locator('#statistics-popup button').allTextContents()).toEqual([
    'Կնքման տարի', 'Համալիր', 'Սենյակ', 'Մակերես',
  ]);
  await page.locator('#statistics-popup').getByRole('button', { name: 'Մակերես', exact: true }).click();
  expect(await pie.locator('g').count()).toBeGreaterThan(1);

  const rooms = await page.locator('.room-filter').boundingBox();
  const area = await page.locator('.range-filter').boundingBox();
  const complex = await page.locator('.complex-filter').boundingBox();
  const period = await page.locator('.date-filter').boundingBox();
  const complexButtons = await page.locator('.complex-buttons').boundingBox();
  const allRooms = page.getByRole('button', { name: 'Բոլորը', exact: true });
  const roomValues = page.locator('.room-values');
  const numberedRooms = await roomValues.locator('button').all();
  if (width < 640) {
    expect(period.x).toBeCloseTo(complex.x, 0);
    expect(complex.y).toBeGreaterThan(period.y);
    expect(rooms.x).toBeGreaterThan(complex.x);
    expect(rooms.y).toBe(complex.y);
    expect(area.y).toBeGreaterThan(rooms.y);
    expect(area.x).toBeCloseTo(period.x, 0);
    expect(area.width).toBeCloseTo(period.width, 0);
  } else {
    expect(area.x).toBeGreaterThan(rooms.x);
    expect(area.y).toBe(rooms.y);
    expect(complex.x).toBeGreaterThan(period.x);
    expect(complex.y).toBe(period.y);
    expect(complex.x).toBeCloseTo(area.x, 0);
    expect(complex.width).toBeCloseTo(area.width, 0);
    expect(complexButtons.width).toBeCloseTo(complex.width, 0);
    expect(complex.y + complex.height).toBeLessThan(rooms.y);

    const tower = await page.getByRole('button', { name: 'Թաուեր', exact: true }).boundingBox();
    const hills = await page.getByRole('button', { name: 'Հիլլս', exact: true }).boundingBox();
    expect(tower.x).toBeCloseTo(complex.x, 0);
    expect(hills.x).toBeCloseTo(tower.x, 0);
    expect(tower.width).toBeCloseTo(complex.width, 0);
    expect(hills.width).toBeCloseTo(tower.width, 0);
    expect(hills.y).toBeGreaterThan(tower.y + tower.height);

    const allRoomsBox = await allRooms.boundingBox();
    const roomValuesBox = await roomValues.boundingBox();
    expect(roomValuesBox.width).toBeCloseTo(allRoomsBox.width, 0);
    expect(await roomValues.locator('button').allTextContents()).toEqual(['1', '2', '3', '4', '5']);
    for (const button of numberedRooms) {
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThan(allRoomsBox.x + allRoomsBox.width);
      expect(box.y).toBeCloseTo(allRoomsBox.y, 0);
    }
  }
  await numberedRooms.at(-1).click();
  expect(await count.innerText()).toBe('1');
  await allRooms.click();
  expect(await count.innerText()).toBe('2');

  await page.locator('#area-min').fill('60');
  expect(await count.innerText()).toBe('1');
  await page.locator('.property-report .deals-list-header').click();
  await page.locator('.property-report tbody tr').waitFor();
  expect(await page.locator('.property-report tbody a').getAttribute('href')).toMatch(/\/2\/$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.locator('.property-menu-trigger').click();
  expect(await page.getByRole('menuitem').allTextContents()).toEqual([
    'Կնքված բնակարաններ', 'Տուն Էքսպո Նոյեմբեր 2026',
  ]);
  await page.getByRole('menuitem', { name: 'Տուն Էքսպո Նոյեմբեր 2026' }).click();
  const leads = page.getByTestId('expo-leads');
  await leads.waitFor();
  expect(await leads.innerText()).toBe('1');
  const expoHeader = await headerSize('.expo-panel');
  expect(apartmentHeader.height).toBeCloseTo(expoHeader.height, 0);
  expect(apartmentHeader.gap).toBeCloseTo(expoHeader.gap, 0);
  const expoToggle = width < 640
    ? page.locator('.expo-column').filter({ has: leads }).locator('.expo-records-toggle')
    : page.locator('.expo-desktop-toggle');
  await expoToggle.click();
  await page.locator('.expo-panel .expo-record-row').waitFor();
  expect(await page.locator('.expo-comparison').count()).toBe(0);
  expect(requests.some(request => request.pathname.startsWith('/api/parking') ||
    request.pathname === '/api/property-stages' || request.searchParams.get('view') === 'comparison')).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
