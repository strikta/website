import { expect, test } from 'vitest';
import { workspace } from '../tool/fixture.ts';
import { pageMeta, robotsText, sitemapXml } from './meta.ts';
import { loadStage } from './stage.ts';

test.each([
	['/', 'https://strikta.dev/'],
	['/how-it-works/', 'https://strikta.dev/how-it-works'],
	['/legal/privacy/index.html', 'https://strikta.dev/legal/privacy'],
	['/404.html', 'https://strikta.dev/404']
])('the canonical URL of %s is %s', (path, canonical) => {
	expect(pageMeta({ description: 'Synthetic.', path }).canonical).toBe(canonical);
});

test('a page title is followed by the site name, and a description over 155 characters fails the build', () => {
	expect(pageMeta({ title: 'ZZZ', description: 'Synthetic.', path: '/' }).heading).toBe('ZZZ · Strikta');
	expect(() => pageMeta({ description: 'x'.repeat(156), path: '/zzz' })).toThrow('keep it to 155');
});

test('the sitemap lists the stage\'s pages only, without files, trees, the 404 page or the pages reached after paying', () => {
	const tree = workspace({
		'data/stage.yaml': [
			'current: stage2',
			'routes:',
			'  - {path: /, stages: [stage2]}',
			'  - {path: /zzz, stages: [stage2]}',
			'  - {path: /zzz-later, stages: [later]}',
			'  - {path: /404, stages: [stage2]}',
			'  - {path: /pro/thanks, stages: [stage2]}',
			'  - {path: /robots.txt, stages: [stage2]}',
			'  - {path: /docs/**, stages: [stage2]}',
			''
		].join('\n')
	});
	const table = loadStage(tree.directory);
	tree.remove();
	const xml = table === undefined ? '' : sitemapXml(table);
	expect([...xml.matchAll(/<loc>(?<url>[^<]+)<\/loc>/gu)].map((match) => match.groups?.['url'])).toEqual(['https://strikta.dev/', 'https://strikta.dev/zzz']);
});

test('robots.txt allows everything but the pages reached after paying, and names the sitemap', () => {
	expect(robotsText()).toBe('User-agent: *\nAllow: /\nDisallow: /pro/thanks\nDisallow: /pro/consent\nSitemap: https://strikta.dev/sitemap.xml\n');
});
