import { covers, type Stage, stageRoutes } from './stage.ts';

/** The site's origin: canonical and Open Graph URLs are absolute. */
const ORIGIN = 'https://strikta.dev';
/** Search engines show about this many characters of a description. */
const DESCRIPTION_LIMIT = 155;
const IMAGE = { url: `${ORIGIN}/brand/social.png`, width: '1280', height: '640', alt: 'The Strikta logo, white on black.' };
/** Pages built but never listed for search engines; the visitor reaches them only after an action. */
const UNLISTED: readonly string[] = ['/404', '/pro/thanks', '/pro/consent', '/cancel/received', '/withdraw/received'];
/** Pages that search engines are asked not to crawl. */
const DISALLOWED: readonly string[] = ['/pro/thanks', '/pro/consent'];

export type Meta = { readonly heading: string; readonly canonical: string; readonly image: typeof IMAGE };

/** A page's title, canonical URL and social image; a description over 155 characters fails the build. */
export function pageMeta(page: { readonly title?: string | undefined; readonly description: string; readonly path: string }): Meta {
	if (page.description.length > DESCRIPTION_LIMIT) {
		throw new Error(`The description of ${page.path} has ${String(page.description.length)} characters; keep it to ${String(DESCRIPTION_LIMIT)}.`);
	}
	const heading = page.title === undefined ? 'Strikta' : `${page.title} · Strikta`;
	const meta = { heading, canonical: `${ORIGIN}${routeOf(page.path)}`, image: IMAGE };
	return meta;
}

/** The sitemap of the stage's listed pages: every page route of the stage table, without files, trees and unlisted pages. */
export function sitemapXml(table: Stage): string {
	const pages = stageRoutes(table).filter((entry) => !entry.endsWith('/**') && !entry.slice(1).includes('.') && !UNLISTED.some((unlisted) => covers(unlisted, entry)));
	const urls = pages.map((page) => `\t<url><loc>${ORIGIN}${page}</loc></url>\n`).join('');
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
	return xml;
}

/** `robots.txt`: everything may be crawled except the pages reached only after paying, and the sitemap is named. */
export function robotsText(): string {
	const lines = ['User-agent: *', 'Allow: /', ...DISALLOWED.map((path) => `Disallow: ${path}`), `Sitemap: ${ORIGIN}/sitemap.xml`, ''];
	const text = lines.join('\n');
	return text;
}

/** A request path as the stage table names it: no trailing slash and no `index.html`, except the home page. */
function routeOf(path: string): string {
	const trimmed = path.replace(/(?:\/index\.html|\.html)$/u, '').replace(/\/+$/u, '');
	const route = trimmed === '' ? '/' : trimmed;
	return route;
}
