import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loadStage, stageRoutes } from '../src/stage.ts';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const stage = loadStage(process.cwd());
const pages = (stage === undefined ? [] : stageRoutes(stage)).filter((route) => !route.includes('.') && !route.endsWith('/**'));

for (const route of pages) {
	test(`${route} stays on its origin, sets no cookie, has one top-level heading and passes axe`, async ({ page, baseURL }) => {
		const foreign = await watchForeign(page, baseURL);
		await page.goto(route);
		const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
		expect(foreign).toEqual([]);
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
