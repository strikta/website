import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DRAFT, legal, security, type LegalPage } from '../src/navigation.ts';
import { filledFile, filledText, loadExport, NOTED, type Export } from '../src/quote.ts';
import { loadSlots, optionalSlot, type Slots } from '../src/slot.ts';
import { covers, loadStage, priced, stageRoutes, withheld, type Stage } from '../src/stage.ts';
import { lineAt, type Finding } from './finding.ts';
import { plainLine, TABLE_ROW, TABLE_RULE } from './legal.ts';
import { emailFindings, hostFindings, internalFindings } from './text.ts';

type Page = { readonly route: string; readonly file: string; readonly html: string; readonly text: string };
type Region = { readonly text: string; readonly allowed: ReadonlySet<string> };
type Context = { readonly root: string; readonly slots: Slots; readonly stage: Stage; readonly hosts: readonly string[]; readonly placeholder: RegExp };
type Built = { readonly pages: readonly Page[]; readonly files: readonly string[]; readonly styles: readonly Page[]; readonly scripts: readonly Page[] };

const PLACEHOLDER = String.raw`\{[a-z_.]+\}|\[[a-z][^\]]{2,40}\]`;
const SPECIAL = /[.*+?^${}()|[\]\\]/gu;
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
const LEGAL_PAGES: readonly LegalPage[] = [...legal, security];
const MAIN = /<main\b(?:[^>"']|"[^"]*"|'[^']*')*>(?<main>[\s\S]*)<\/main\s*>/iu;
const NAV = /<nav\b[\s\S]*?<\/nav\s*>/giu;
const HEADING_MARK = /^(?:#{1,2}|-) /u;
const EXCERPT_LENGTH = 60;
const NONE: ReadonlySet<string> = new Set();
const INLINE_TAG = /(?<tag><(?<name>[a-z][a-z0-9-]*)\b(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>)/giu;
const ATTRIBUTE = /(?<=[\s/"'])(?<name>[^\s=>/"']+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+)))?/gu;
const HANDLER = /^on[a-z]+$/u;
const SECTION_END = /<\/(?:section|main|body)\s*>/iu;
const SCRIPT_SCHEME = /^\s*javascript:/iu;

/**
 * `dist/`: no placeholder, price word, early price figure, third-party request, internal ID, host, stray page, missing quote or over-budget page.
 * The <main> of a draft legal page, marked "Draft, not in force", may show the placeholders and price figures that occur as whole matches in its own
 * exported text, and nothing else. No page holds an inline style, inline script, event handler or javascript: URL, which the site's CSP blocks.
 */
export function builtFindings(dist: string, root: string, hosts: readonly string[]): readonly Finding[] {
	const built = readBuilt(dist, root);
	const slots = loadSlots(root);
	const stage = loadStage(root) ?? NO_STAGE;
	const placeholder = placeholderPattern(loadExport(join(root, 'content', 'export')));
	const pageFindings = built.pages.flatMap((page) => textFindings(page, { root, slots, stage, hosts, placeholder }));
	const styleFindings = built.styles.flatMap((style) => thirdPartyFindings(style, slots));
	const scriptFindings = built.scripts.flatMap(absoluteFindings);
	const findings = [...pageFindings, ...styleFindings, ...scriptFindings, ...quoteFindings(built, root, slots, stage), ...legalFindings(built, root, slots), ...stageFindings(built, stage), ...budgetFindings(dist, built)];
	return findings;
}

/** The text a browser shows for a page: body text without tags, blocks apart, entities decoded, whitespace runs collapsed. */
export function visibleText(html: string): string {
	const body = BODY.exec(html)?.groups?.['body'] ?? html;
	const text = collapse(decode(body.replace(HIDDEN, '').replace(BLOCK_TAG, ' ').replace(TAG, '')));
	return text;
}

/** One page's text and markup: placeholders, price words and figures, requests, inline code, internal IDs, emails and hosts. */
function textFindings(page: Page, context: Context): readonly Finding[] {
	const { slots, stage, hosts, placeholder } = context;
	const parts = regions(page, draftTokens(page, context));
	const findings = [
		...placeholderFindings(page, parts, placeholder),
		...priceFindings(page),
		...(priced(stage) ? [] : figureFindings(page, parts, stage)),
		...thirdPartyFindings(page, slots),
		...inlineFindings(page),
		...noteFindings(page),
		...internalFindings(page.file, page.text),
		...emailFindings(page.file, page.text),
		...hostFindings(page.file, page.html, hosts)
	];
	return findings;
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

/** The placeholders and price figures that occur as whole matches in a draft legal page's own exported text as the page fills it; none for any other page. */
function draftTokens(page: Page, context: Context): ReadonlySet<string> {
	const { root, slots, placeholder } = context;
	const entry = LEGAL_PAGES.find((candidate) => candidate.route === page.route && candidate.draft);
	const directory = join(root, 'content', 'export');
	const index = entry === undefined ? undefined : loadExport(directory);
	if (entry === undefined || index?.files.some((file) => file.path === entry.file) !== true) {
		return NONE;
	}
	const text = collapse(filledFile(index, entry.file, readFileSync(join(directory, entry.file), 'utf8'), slots, true));
	const tokens = new Set(matches(text, [placeholder, PRICE_FIGURE]));
	return tokens;
}

/** A page's text in regions, each with the placeholders and price figures it may show: only the <main> of a page with draft tokens may show any. */
function regions(page: Page, allowed: ReadonlySet<string>): readonly Region[] {
	const main = MAIN.exec(page.html)?.groups?.['main'];
	if (allowed.size === 0 || main === undefined) {
		const whole = [{ text: page.text, allowed: NONE }];
		return whole;
	}
	const split = [
		{ text: visibleText(main), allowed },
		{ text: visibleText(page.html.replace(MAIN, '')), allowed: NONE }
	];
	return split;
}

/** Slot names in braces, short bracketed phrases, and every placeholder the export maps to a slot, longest first, each captured in a `found` group. */
function placeholderPattern(index: Export | undefined): RegExp {
	const keys = [...new Set(index?.quotes.flatMap((entry) => Object.keys(entry.fills)) ?? [])].sort((first, second) => second.length - first.length);
	const pattern = new RegExp(`(?<found>${[...keys.map((key) => key.replace(SPECIAL, String.raw`\$&`)), PLACEHOLDER].join('|')})`, 'gu');
	return pattern;
}

function placeholderFindings(page: Page, parts: readonly Region[], placeholder: RegExp): readonly Finding[] {
	const findings = parts.flatMap((part) => disallowed(part, [placeholder])).map((found) => pageFinding(page, found, 'placeholder', 'unfilled slot or placeholder', 'Three kinds of text'));
	return findings;
}

function priceFindings(page: Page): readonly Finding[] {
	const body = BODY.exec(page.html)?.groups?.['body'] ?? page.html;
	const blocks = body.replace(HIDDEN, '').split(BLOCK_TAG).map((block) => collapse(decode(block.replace(TAG, ''))));
	const offending = blocks.filter((block) => block.includes('€') && PRICE_WORDS.test(block));
	const findings = offending.map((block) => pageFinding(page, block, 'price-words', 'no %, save, discount or countdown near a price', 'Three kinds of text'));
	return findings;
}

function figureFindings(page: Page, parts: readonly Region[], stage: Stage): readonly Finding[] {
	const findings = parts
		.flatMap((part) => disallowed(part, [PRICE_FIGURE]))
		.map((found) => pageFinding(page, found, 'price-figure', `"${found}": stage ${stage.current} publishes no price figure; hold the section back in data/stage.yaml`, 'Stages [provisional]'));
	return findings;
}

/** The whole matches of the patterns in a region's text that the region may not show. */
function disallowed(part: Region, patterns: readonly RegExp[]): readonly string[] {
	const found = matches(part.text, patterns).filter((token) => !part.allowed.has(token));
	return found;
}

/** The text of every match of the patterns, each captured in a `found` group. */
function matches(text: string, patterns: readonly RegExp[]): readonly string[] {
	const found = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match.groups?.['found'] ?? ''));
	return found;
}

/** Each quote that needs a note is followed, in the same section, by an element with that note's `data-note` name and visible text. */
function noteFindings(page: Page): readonly Finding[] {
	const findings = Object.entries(NOTED).flatMap(([identifier, note]) => {
		const marker = `data-quote="${identifier}"`;
		const [, ...following] = page.html.split(marker);
		const missing = following.filter((after) => {
			const [section = ''] = after.split(SECTION_END);
			const shown = noted(section, note);
			return !shown;
		});
		const found = missing.map(() => pageFinding(page, marker, 'note', `quote "${identifier}" is shown without its "${note}" note after it in the same section`, 'Three kinds of text'));
		return found;
	});
	return findings;
}

/** Whether markup holds an element with a `data-note` name and visible text. */
function noted(markup: string, note: string): boolean {
	const element = new RegExp(`<(?<tag>[a-z][a-z0-9-]*)\\b[^>]*\\bdata-note="${note}"[^>]*>(?<content>[\\s\\S]*?)</\\k<tag>\\s*>`, 'iu');
	const content = element.exec(markup)?.groups?.['content'] ?? '';
	const shown = visibleText(content) !== '';
	return shown;
}

/** Inline style and script elements, style attributes, event handlers and javascript: URLs: the site's CSP blocks each. */
function inlineFindings(page: Page): readonly Finding[] {
	const found = [...page.html.matchAll(INLINE_TAG)].flatMap((match) => inlineCode(match.groups?.['name']?.toLowerCase() ?? '', match.groups?.['attributes'] ?? '', match.groups?.['tag'] ?? ''));
	const findings = found.map((tag) => pageFinding(page, tag, 'inline', `"${tag.slice(0, EXCERPT_LENGTH)}": the site's CSP blocks inline style and script; move it to a file`, 'Hard boundaries'));
	return findings;
}

/** The tag itself when it opens inline code: a style element, a script without a source, a style or event-handler attribute, or a javascript: URL. */
function inlineCode(name: string, attributes: string, tag: string): readonly string[] {
	const pairs = [...attributes.matchAll(ATTRIBUTE)].map((match) => ({ name: match.groups?.['name']?.toLowerCase() ?? '', value: match.groups?.['double'] ?? match.groups?.['single'] ?? match.groups?.['bare'] ?? '' }));
	const element = name === 'style' || (name === 'script' && !pairs.some((pair) => pair.name === 'src'));
	const attribute = pairs.some((pair) => pair.name === 'style' || HANDLER.test(pair.name) || SCRIPT_SCHEME.test(pair.value));
	const code = element || attribute ? [tag] : [];
	return code;
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
		const missing = shown.filter((page) => !page.text.includes(collapse(filledText(quote, slots, draft(page.route)))));
		const absent = missing.map((page) => pageFinding(page, '', 'quote-presence', `quote "${quote.id}" is missing: render it with <Quote>; never retype it`, 'Three kinds of text'));
		return absent;
	});
	return findings;
}

/** Each built legal page shows every line of its exported text in its <main>, outside the contents list, in the file's order. */
function legalFindings(built: Built, root: string, slots: Slots): readonly Finding[] {
	const directory = join(root, 'content', 'export');
	const index = loadExport(directory);
	const findings = built.pages.flatMap((page) => {
		const entry = LEGAL_PAGES.find((candidate) => candidate.route === page.route);
		const found = entry === undefined ? [] : legalPageFindings(page, entry.file, directory, index, slots);
		return found;
	});
	return findings;
}

function legalPageFindings(page: Page, file: string, directory: string, index: Export | undefined, slots: Slots): readonly Finding[] {
	if (index?.files.some((exported) => exported.path === file) !== true) {
		const absent = [pageFinding(page, '', 'legal-text', `no exported file "${file}": a new export is needed`, 'Three kinds of text')];
		return absent;
	}
	const lines = exportedLines(filledFile(index, file, readFileSync(join(directory, file), 'utf8'), slots, draft(page.route)));
	const text = mainText(page.html);
	const missing = unmatched(text, lines).map((line) =>
		pageFinding(page, '', 'legal-text', `"${line.slice(0, EXCERPT_LENGTH)}" of ${file} is missing or out of order: render it with <Legal>; never retype it`, 'Three kinds of text')
	);
	const unmarked = draft(page.route) && !text.includes(DRAFT) ? [pageFinding(page, '', 'legal-text', `a draft legal page says "${DRAFT}" in its <main>: render it with <Legal draft>`, 'Three kinds of text')] : [];
	const findings = [...unmarked, ...missing];
	return findings;
}

/** The text of each non-empty line of an exported legal text as a page shows it: heading and item marks, table pipes, emphasis marks and escaping backslashes removed. */
function exportedLines(content: string): readonly string[] {
	const lines = content
		.split('\n')
		.filter((line) => line.trim() !== '' && !TABLE_RULE.test(line))
		.map((line) => {
			const cells = TABLE_ROW.exec(line)?.groups?.['cells'];
			const marked = cells === undefined ? line.replace(HEADING_MARK, '') : cells.split('|').map((cell) => cell.trim()).join(' ');
			const plain = collapse(plainLine(marked));
			return plain;
		});
	return lines;
}

/** The visible text of a page's <main> without its navigation, such as a contents list. */
function mainText(html: string): string {
	const main = MAIN.exec(html)?.groups?.['main'] ?? '';
	const text = visibleText(main.replace(NAV, ''));
	return text;
}

/** The lines a text does not hold in order, each searched for after the end of the last one found. */
function unmatched(text: string, lines: readonly string[]): readonly string[] {
	const missing: string[] = [];
	let position = 0;
	for (const line of lines) {
		const found = text.indexOf(line, position);
		if (found < 0) {
			missing.push(line);
		} else {
			position = found + line.length;
		}
	}
	return missing;
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

/** Whether a route is a legal page marked as a draft. */
function draft(route: string): boolean {
	const marked = LEGAL_PAGES.some((page) => page.route === route && page.draft);
	return marked;
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
