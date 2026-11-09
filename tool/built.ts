import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { filledText, loadExport } from '../src/quote.ts';
import { loadSlots, optionalSlot, type Slots } from '../src/slot.ts';
import { covers, loadStage, priced, stageRoutes, withheld, type Stage } from '../src/stage.ts';
import { lineAt, type Finding } from './finding.ts';
import { emailFindings, hostFindings, internalFindings } from './text.ts';

type Page = { readonly route: string; readonly file: string; readonly html: string; readonly text: string };
type Built = { readonly pages: readonly Page[]; readonly files: readonly string[]; readonly styles: readonly Page[]; readonly scripts: readonly Page[] };

const PLACEHOLDERS: readonly RegExp[] = [/(?<found>\{[a-z_.]+\})/gu, /(?<found>\[[a-z][^\]]{2,40}\])/gu];
const PRICE_WORDS = /%|\bsave\b|\bdiscount|\bcountdown\b|\bonly \d+ days?\b/iu;
const PRICE_FIGURE = /(?<found>(?:€|\bEUR|\bSEK)\s?\d[\d,.]*|\d[\d,.]*\s?(?:€|EUR\b|SEK\b))/gu;
const BLOCK_TAG = /<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|td|th|tr|ul)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/gu;
const HIDDEN = /<(?<tag>script|style|template|noscript)\b[\s\S]*?<\/\k<tag>\s*>|<!--[\s\S]*?-->/giu;
const BODY = /<body\b(?:[^>"']|"[^"]*"|'[^']*')*>(?<body>[\s\S]*)<\/body\s*>/iu;
const REQUESTS: readonly RegExp[] = [
	/\b(?:src|poster|action|data)\s*=\s*["']?(?<url>[^"'\s>]+)/giu,
	/\b(?:srcset|ping)\s*=\s*["'](?<url>[^"']+)/giu,
	/\bcontent\s*=\s*["']?\s*\d+\s*;\s*url\s*=\s*["']?(?<url>[^"'\s>]+)/giu,
	/<link\b(?:[^>"']|"[^"]*"|'[^']*')*?\bhref\s*=\s*["']?(?<url>[^"'\s>]+)/giu,
	/\burl\(\s*["']?(?<url>[^"')\s]+)/giu,
	/@import\s+(?:url\(\s*)?["']?(?<url>[^"')\s;]+)/giu
];
const FOREIGN_HOST = /(?:^|[\s,])(?:[a-z][a-z0-9+.-]*:)?\/\/(?<host>[^/?#:\s,]+)/giu;
const SCRIPT_URL = /(?<url>\bhttps?:\/\/[^\s"'`)\\]+)/giu;
const SCRIPT = /\.m?js$/u;
const SITE_HOST = 'strikta.dev';
const CHECKOUT = '/pro/checkout';
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', euro: '€', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©' };
const NO_STAGE: Stage = { current: 'none (data/stage.yaml is missing)', routes: [], priced: [], withheld: [] };
const HOME_BUDGET = 120 * 1024;
const SCRIPT_BUDGET = 1024;
const LOCAL_ASSET = /^\/(?!\/)[^?#]*\.(?:css|m?js|woff2)$/u;

/** `dist/`: no placeholder, price word, early price figure, third-party request, internal ID, host, stray page, missing quote or over-budget page. */
export function builtFindings(dist: string, root: string, hosts: readonly string[]): readonly Finding[] {
	const built = readBuilt(dist, root);
	const slots = loadSlots(root);
	const stage = loadStage(root) ?? NO_STAGE;
	const pageFindings = built.pages.flatMap((page) => [
		...placeholderFindings(page),
		...priceFindings(page),
		...(priced(stage) ? [] : figureFindings(page, stage)),
		...thirdPartyFindings(page, slots),
		...internalFindings(page.file, page.text),
		...emailFindings(page.file, page.text),
		...hostFindings(page.file, page.html, hosts)
	]);
	const styleFindings = built.styles.flatMap((style) => thirdPartyFindings(style, slots));
	const scriptFindings = built.scripts.flatMap(absoluteFindings);
	const findings = [...pageFindings, ...styleFindings, ...scriptFindings, ...quoteFindings(built, root, slots, stage), ...stageFindings(built, stage), ...budgetFindings(dist, built)];
	return findings;
}

/** The text a browser shows for a page: body text without tags, blocks apart, entities decoded, whitespace runs collapsed. */
export function visibleText(html: string): string {
	const body = BODY.exec(html)?.groups?.['body'] ?? html;
	const text = collapse(decode(body.replace(HIDDEN, '').replace(BLOCK_TAG, ' ').replace(TAG, '')));
	return text;
}

function readBuilt(dist: string, root: string): Built {
	const files = readdirSync(dist, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/'));
	const read = (file: string): Page => {
		const html = readFileSync(join(dist, file), 'utf8');
		const page = { route: routeOf(file), file: relative(root, join(dist, file)), html, text: visibleText(html) };
		return page;
	};
	const built = { pages: files.filter((file) => file.endsWith('.html')).map(read), files: files.map((file) => `/${file}`), styles: files.filter((file) => file.endsWith('.css')).map(read), scripts: files.filter((file) => SCRIPT.test(file)).map(read) };
	return built;
}

function routeOf(file: string): string {
	const page = file.replace(/(?:^|\/)index\.html$/u, '').replace(/\.html$/u, '');
	const route = `/${page}`;
	return route;
}

function placeholderFindings(page: Page): readonly Finding[] {
	const findings = PLACEHOLDERS.flatMap((pattern) =>
		[...page.text.matchAll(pattern)].map((match) => pageFinding(page, match.groups?.['found'] ?? '', 'placeholder', 'unfilled slot or placeholder', 'Three kinds of text'))
	);
	return findings;
}

function priceFindings(page: Page): readonly Finding[] {
	const body = BODY.exec(page.html)?.groups?.['body'] ?? page.html;
	const blocks = body.replace(HIDDEN, '').split(BLOCK_TAG).map((block) => collapse(decode(block.replace(TAG, ''))));
	const offending = blocks.filter((block) => block.includes('€') && PRICE_WORDS.test(block));
	const findings = offending.map((block) => pageFinding(page, block, 'price-words', 'no %, save, discount or countdown near a price', 'Three kinds of text'));
	return findings;
}

function figureFindings(page: Page, stage: Stage): readonly Finding[] {
	const findings = [...page.text.matchAll(PRICE_FIGURE)].map((match) =>
		pageFinding(page, match.groups?.['found'] ?? '', 'price-figure', `"${match.groups?.['found'] ?? ''}": stage ${stage.current} publishes no price figure; hold the section back in data/stage.yaml`, 'Stages [provisional]')
	);
	return findings;
}

function thirdPartyFindings(page: Page, slots: Slots): readonly Finding[] {
	const merchant = page.route === CHECKOUT ? optionalSlot(slots, 'merchant.script_host') : undefined;
	const urls = REQUESTS.flatMap((pattern) => [...page.html.matchAll(pattern)].map((match) => match.groups?.['url'] ?? ''));
	const own = new Set(merchant === undefined ? [SITE_HOST] : [SITE_HOST, merchant]);
	const findings = foreignFindings(page, urls, own);
	return findings;
}

function foreignFindings(page: Page, urls: readonly string[], own: ReadonlySet<string>): readonly Finding[] {
	const foreign = urls.filter((url) => [...url.matchAll(FOREIGN_HOST)].some((match) => !own.has(match.groups?.['host']?.toLowerCase() ?? '')));
	const findings = foreign.map((url) => pageFinding(page, url, 'third-party', `"${url}": no third-party request; self-host it`, 'Hard boundaries'));
	return findings;
}

function absoluteFindings(script: Page): readonly Finding[] {
	const urls = [...script.html.matchAll(SCRIPT_URL)].map((match) => match.groups?.['url'] ?? '');
	const findings = foreignFindings(script, urls, new Set([SITE_HOST]));
	return findings;
}

function quoteFindings(built: Built, root: string, slots: Slots, stage: Stage): readonly Finding[] {
	const quotes = loadExport(join(root, 'content', 'export'))?.quotes ?? [];
	const pages = new Map(built.pages.map((page) => [page.route, page]));
	const findings = quotes.flatMap((quote) => {
		const shown = quote.pages.filter((route) => !withheld(stage, route, quote.id)).flatMap((route) => pages.get(route) ?? []);
		const text = shown.length === 0 ? '' : collapse(filledText(quote, slots));
		const missing = shown.filter((page) => !page.text.includes(text));
		const absent = missing.map((page) => pageFinding(page, '', 'quote-presence', `quote "${quote.id}" is missing: render it with <Quote>; never retype it`, 'Three kinds of text'));
		return absent;
	});
	return findings;
}

function stageFindings(built: Built, table: Stage): readonly Finding[] {
	const expected = stageRoutes(table);
	const stray = built.pages.filter((page) => !expected.some((entry) => covers(entry, page.route)));
	const absent = expected.filter((entry) => !built.pages.some((page) => covers(entry, page.route)) && !built.files.includes(entry));
	const findings = [
		...stray.map((page) => pageFinding(page, '', 'stage', `page outside stage ${table.current}`, 'Stages [provisional]')),
		...absent.map((entry) => ({ file: 'data/stage.yaml', line: 1, rule: 'stage', fix: `${entry} belongs to stage ${table.current} but was not built`, section: 'Stages [provisional]' }))
	];
	return findings;
}

/** The home page with every stylesheet, script and font it can load stays within 120 KB; all scripts together within 1 KB. */
function budgetFindings(dist: string, built: Built): readonly Finding[] {
	const home = built.pages.find((page) => page.route === '/');
	const assets = home === undefined ? [] : localAssets(built.files, home.html);
	const fonts = assets.filter((asset) => asset.endsWith('.css')).flatMap((sheet) => localAssets(built.files, readFileSync(join(dist, sheet), 'utf8')));
	const homeSize = home === undefined ? 0 : Buffer.byteLength(home.html) + [...new Set([...assets, ...fonts])].reduce((total, asset) => total + statSync(join(dist, asset)).size, 0);
	const scriptSize = built.scripts.reduce((total, script) => total + Buffer.byteLength(script.html), 0);
	const findings = [
		...(home !== undefined && homeSize > HOME_BUDGET ? [pageFinding(home, '', 'budget', `home page loads ${String(homeSize)} bytes, over the ${String(HOME_BUDGET)} budget`, 'Code standards (TypeScript and .astro)')] : []),
		...(scriptSize > SCRIPT_BUDGET ? [{ file: 'dist', line: 1, rule: 'budget', fix: `${String(scriptSize)} bytes of JavaScript, over the ${String(SCRIPT_BUDGET)} budget`, section: 'Code standards (TypeScript and .astro)' }] : [])
	];
	return findings;
}

function localAssets(files: readonly string[], text: string): readonly string[] {
	const urls = REQUESTS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match.groups?.['url'] ?? ''));
	const assets = urls.filter((url) => LOCAL_ASSET.test(url) && files.includes(url)).map((url) => url.slice(1));
	return assets;
}

function pageFinding(page: Page, excerpt: string, rule: string, fix: string, section: string): Finding {
	const position = excerpt === '' ? -1 : page.html.indexOf(excerpt);
	const finding = { file: page.file, line: position < 0 ? 1 : lineAt(page.html, position), rule, fix, section };
	return finding;
}

function decode(html: string): string {
	const text = html.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (entity: string, decimal?: string, hex?: string, name?: string) => {
		const code = decimal === undefined ? (hex === undefined ? undefined : Number.parseInt(hex, 16)) : Number.parseInt(decimal, 10);
		const character = code === undefined ? (ENTITIES[name ?? ''] ?? entity) : String.fromCodePoint(code);
		return character;
	});
	return text;
}

function collapse(text: string): string {
	const collapsed = text.replace(/\s+/gu, ' ').trim();
	return collapsed;
}
