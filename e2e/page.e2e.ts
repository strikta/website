import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loadStage, stageRoutes } from '../src/stage.ts';
import { POLICY } from '../tool/serve.ts';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const stage = loadStage(process.cwd());
const pages = (stage === undefined ? [] : stageRoutes(stage)).filter((route) => !route.includes('.') && !route.endsWith('/**'));

for (const route of pages) {
	test(`${route} stays on its origin, renders styled under the site's CSP, sets no cookie, has one top-level heading and passes axe`, async ({ page, baseURL }) => {
		const foreign = await watchForeign(page, baseURL);
		const violations = watchPolicy(page);
		const response = await page.goto(route);
		const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
		expect(foreign).toEqual([]);
		expect(response?.headers()['content-security-policy']).toBe(POLICY);
		expect(violations).toEqual([]);
		expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Inter');
		expect(scan.violations).toEqual([]);
		await expect(page.locator('h1')).toHaveCount(1);
		expect(await page.context().cookies()).toEqual([]);
	});
}

test('the narrow menu opens without script and lists the header links', async ({ page }) => {
	await page.goto('/');
	const menu = page.locator('details.menu');
	test.skip(!(await menu.isVisible()), 'the menu shows only below 640 px');
	await menu.locator('summary').click();
	await expect(menu.getByRole('link', { name: 'Pro', exact: true })).toBeVisible();
	const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
	expect(scan.violations).toEqual([]);
});

test('the site ships no script', async ({ page }) => {
	await page.goto('/');
	expect(await page.locator('script').count()).toBe(0);
});

test('the home hero shows its sections in render order and then opens the slit, and reduced motion shows the final state at once', async ({ page }) => {
	await page.goto('/');
	const rows = page.locator('.hero .section');
	const slit = page.locator('.hero .mark .left');
	expect(await rows.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName))).toEqual(Array.from({ length: await rows.count() }, () => 'appear'));
	expect(await slit.evaluate((path) => getComputedStyle(path).animationName)).toBe('slit-left');
	await expect(page.locator('h1')).toBeVisible();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await rows.evaluateAll((elements) => elements.map((element) => [getComputedStyle(element).animationName, getComputedStyle(element).opacity].join(' ')))).toEqual(Array.from({ length: await rows.count() }, () => 'none 1'));
	expect(await slit.evaluate((path) => [getComputedStyle(path).animationName, getComputedStyle(path).transform].join(' '))).toBe('none none');
});

test('the home page\'s largest contentful paint is the unanimated headline at 1440 px, and unanimated hero text at 390 px', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	expect(await largestPaint(page)).toBe('H1#headline');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	expect(await largestPaint(page)).toMatch(/^(?:H1#headline|P\.sub\b.*)$/u);
});

for (const route of pages) {
	test(`${route} uses the 1:6 angle at most once per view and gives every control a 44 px target`, async ({ page }) => {
		await page.goto(route);
		const viewport = page.viewportSize()?.height ?? 0;
		const angles = await page.locator('[data-angle]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top + window.scrollY));
		const crowded = angles.filter((top, index) => angles.slice(index + 1).some((other) => Math.abs(other - top) < viewport));
		const controls = page.locator('.button, button:visible, summary:visible, header nav a:visible, footer nav a');
		const small = await controls.evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height < 44).map((element) => element.textContent));
		expect(crowded).toEqual([]);
		expect(small).toEqual([]);
	});

	test(`${route} reflows to one column at 320 px wide, as at 400 % zoom, and scrolls sideways only in focusable regions`, async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 256 });
		await page.goto(route);
		expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
		const unreachable = await page.locator('main *').evaluateAll((elements: Element[]) => elements.filter((element) => element.scrollWidth > element.clientWidth && ['auto', 'scroll'].includes(getComputedStyle(element).overflowX) && !(element instanceof HTMLElement && element.tabIndex >= 0)).map((element) => [element.tagName, ...element.classList].join('.')));
		expect(unreachable).toEqual([]);
	});
}

/** Records and aborts every request that leaves the site's origin. */
async function watchForeign(page: Page, baseURL?: string): Promise<readonly string[]> {
	if (baseURL === undefined) {
		throw new Error('playwright.config.ts sets the base URL');
	}
	const { origin } = new URL(baseURL);
	const foreign: string[] = [];
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		if (new URL(url).origin === origin) {
			await route.continue();
			return;
		}
		foreign.push(url);
		await route.abort();
	});
	return foreign;
}

/** Records every console message in which the browser reports a Content-Security-Policy violation. */
function watchPolicy(page: Page): readonly string[] {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('Content Security Policy')) {
			violations.push(message.text());
		}
	});
	return violations;
}

/** The largest contentful paint's element as `TAG#id` or `TAG.class`, its nearest heading or paragraph, once it has no animation. */
async function largestPaint(page: Page): Promise<string> {
	const element = await page.evaluate(async () => new Promise<string>((resolve) => {
		new PerformanceObserver((observed) => {
			const [entry] = observed.getEntries().slice(-1);
			const painted = entry instanceof LargestContentfulPaint ? entry.element?.closest('h1, p') : undefined;
			if (painted === null || painted === undefined || getComputedStyle(painted).animationName !== 'none') {
				resolve('none');
				return;
			}
			const name = painted.id === '' ? `.${[...painted.classList].join('.')}` : `#${painted.id}`;
			resolve(`${painted.tagName}${name}`);
		}).observe({ type: 'largest-contentful-paint', buffered: true });
	}));
	return element;
}
