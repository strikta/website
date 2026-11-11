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

test('the home hero plays its one animation, and reduced motion shows the final state at once', async ({ page }) => {
	await page.goto('/');
	const window = page.locator('.intro .window');
	expect(await window.evaluate((element) => getComputedStyle(element).animationName)).toBe('build');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await window.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
	const slit = page.locator('.intro .mark .slit');
	expect(await slit.evaluate((path) => [getComputedStyle(path).animationName, getComputedStyle(path).visibility])).toEqual(['none', 'hidden']);
});

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
