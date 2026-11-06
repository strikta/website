import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';
import { filledText, loadExport } from '../src/quote.ts';
import { loadSlots, optionalSlot, type Slots } from '../src/slot.ts';
import { lineAt, type Finding } from './finding.ts';
import type { Local } from './local.ts';
import { emailFindings, internalFindings, localFindings, privateFindings, termPositions } from './text.ts';

type Page = { readonly route: string; readonly file: string; readonly html: string; readonly text: string };
type Source = { readonly file: string; readonly content: string };
type Built = { readonly pages: readonly Page[]; readonly files: readonly string[]; readonly styles: readonly Page[]; readonly scripts: readonly Page[]; readonly texts: readonly Source[] };

const PLACEHOLDERS: readonly RegExp[] = [/(?<found>\{[a-z_.]+\})/gu, /(?<found>\[[a-z][^\]]{2,40}\])/gu];
const PRICE_WORDS = /%|\bsave\b|\bdiscount|\bcountdown\b|\bonly \d+ days?\b/iu;
const BLOCK_TAG = /<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|td|th|tr|ul)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/gu;
const HIDDEN = /<(?<tag>script|style|template|noscript)\b[\s\S]*?<\/\k<tag>\s*>|<!--[\s\S]*?-->/giu;
const UNSHOWN = /<(?<tag>script|style)\b[\s\S]*?<\/\k<tag>\s*>|<!--[\s\S]*?-->/giu;
const ATTRIBUTE = /\s[^\s"'<>/=]+\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'<>=`]+))/gu;
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
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', euro: '€', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©', shy: '\u00ad' };
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu;
const ESCAPE = /\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0-9a-f]{1,6})\s?)/giu;
const LAST_CODE_POINT = 0x10ffff;
const CONTROL = /(?![\t\n\v\f\r])\p{Cc}/u;
const stageSchema = zod.object({ current: zod.string().min(1), routes: zod.array(zod.object({ path: zod.string().startsWith('/'), stages: zod.array(zod.string()) }).strict()) }).strict();

/** `dist/`: no placeholder, price word, third-party request, internal ID, host, private term (in any text file), stray page or missing quote. */
export function builtFindings(dist: string, root: string, local: Local): readonly Finding[] {
	const built = readBuilt(dist, root);
	const slots = loadSlots(join(root, 'data'));
	const pageFindings = built.pages.flatMap((page) => [
		...placeholderFindings(page),
		...priceFindings(page),
		...thirdPartyFindings(page, slots),
		...internalFindings(page.file, page.text),
		...emailFindings(page.file, page.text),
		...pageLocalFindings(page, local)
	]);
	const requestFindings = [...built.styles.flatMap((style) => thirdPartyFindings(style, slots)), ...built.scripts.flatMap(absoluteFindings)];
	const textFindings = built.texts.flatMap((source) => encodedFindings(source.file, source.content, decode(decodeEscapes(source.content)), local));
	const findings = [...pageFindings, ...requestFindings, ...textFindings, ...quoteFindings(built, root, slots), ...stageFindings(built, root)];
	return findings;
}

/** The text a browser shows for a page: body text without tags, entities decoded, whitespace runs collapsed. */
export function visibleText(html: string): string {
	const body = BODY.exec(html)?.groups?.['body'] ?? html;
	const text = collapse(decode(body.replace(HIDDEN, '').replace(TAG, '')));
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
	const built = {
		pages: files.filter((file) => file.endsWith('.html')).map(read),
		files: files.map((file) => `/${file}`),
		styles: files.filter((file) => file.endsWith('.css')).map(read),
		scripts: files.filter((file) => SCRIPT.test(file)).map(read),
		texts: files.filter((file) => !file.endsWith('.html')).flatMap((file) => sourceOf(join(dist, file), root))
	};
	return built;
}

/** A built file read as text: UTF-8 without a NUL byte, otherwise each UTF-16 reading that is text; none for a binary file. */
function sourceOf(path: string, root: string): readonly Source[] {
	const content = readFileSync(path);
	const file = relative(root, path);
	const readings = content.includes(0) ? wideReadings(content) : [content.toString('utf8')];
	const sources = readings.map((reading) => ({ file, content: reading }));
	return sources;
}

/** The little- and big-endian UTF-16 readings that are well formed and hold no control character but whitespace. */
function wideReadings(content: Buffer): readonly string[] {
	const swapped = Buffer.from(content.subarray(0, content.length - (content.length % 2))).swap16();
	const readings = [content.toString('utf16le'), swapped.toString('utf16le')].filter((reading) => reading.isWellFormed() && !CONTROL.test(reading));
	return readings;
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

function quoteFindings(built: Built, root: string, slots: Slots): readonly Finding[] {
	const quotes = loadExport(join(root, 'content', 'export'))?.quotes ?? [];
	const pages = new Map(built.pages.map((page) => [page.route, page]));
	const findings = quotes.flatMap((quote) => {
		const text = collapse(filledText(quote, slots));
		const missing = quote.pages.flatMap((route) => pages.get(route) ?? []).filter((page) => !page.text.includes(text));
		const absent = missing.map((page) => pageFinding(page, '', 'quote-presence', `quote "${quote.id}" is missing: render it with <Quote>; never retype it`, 'Three kinds of text'));
		return absent;
	});
	return findings;
}

function stageFindings(built: Built, root: string): readonly Finding[] {
	const path = join(root, 'data', 'stage.yaml');
	const table = existsSync(path) ? stageSchema.parse(parse(readFileSync(path, 'utf8'))) : { current: 'none (data/stage.yaml is missing)', routes: [] };
	const expected = table.routes.filter((route) => route.stages.includes(table.current)).map((route) => route.path);
	const stray = built.pages.filter((page) => !expected.some((entry) => covers(entry, page.route)));
	const absent = expected.filter((entry) => !built.pages.some((page) => covers(entry, page.route)) && !built.files.includes(entry));
	const findings = [
		...stray.map((page) => pageFinding(page, '', 'stage', `page outside stage ${table.current}`, 'Stages [provisional]')),
		...absent.map((entry) => ({ file: 'data/stage.yaml', line: 1, rule: 'stage', fix: `${entry} belongs to stage ${table.current} but was not built`, section: 'Stages [provisional]' }))
	];
	return findings;
}

function covers(entry: string, route: string): boolean {
	const prefix = entry.endsWith('/**') ? entry.slice(0, -3) : undefined;
	const covered = prefix === undefined ? entry === route && extname(entry) === '' : route === prefix || route.startsWith(`${prefix}/`);
	return covered;
}

/** Hosts and private terms in the markup, and each other private term its text or attribute values show once decoded. */
function pageLocalFindings(page: Page, local: Local): readonly Finding[] {
	const findings = encodedFindings(page.file, page.html, termText(page.html), local);
	return findings;
}

/** Hosts and private terms in the raw content, and once each other private term only its decoded form shows. */
function encodedFindings(file: string, content: string, decoded: string, local: Local): readonly Finding[] {
	const marked = localFindings(file, content, local);
	const hidden = local.terms.filter((term) => termPositions(content, [term]).length === 0);
	const findings = [...marked, ...hidden.flatMap((term) => privateFindings(file, decoded, [term]).slice(0, 1))];
	return findings;
}

/** The whole document's text with tags joined, <noscript> and <template> included, then each attribute value, then the whole markup with comments, scripts and styles unescaped; all entity-decoded. */
function termText(html: string): string {
	const shown = html.replace(UNSHOWN, '');
	const values = [...shown.matchAll(ATTRIBUTE)].map((match) => match.groups?.['double'] ?? match.groups?.['single'] ?? match.groups?.['bare'] ?? '');
	const text = [shown.replace(TAG, ''), ...values, decodeEscapes(html)].map((part) => collapse(decode(part))).join('\n');
	return text;
}

function pageFinding(page: Page, excerpt: string, rule: string, fix: string, section: string): Finding {
	const position = excerpt === '' ? -1 : page.html.indexOf(excerpt);
	const finding = { file: page.file, line: position < 0 ? 1 : lineAt(page.html, position), rule, fix, section };
	return finding;
}

/** HTML entities decoded; an unknown name or a number past the last code point stays as written. */
function decode(html: string): string {
	const text = html.replace(ENTITY, (entity: string, decimal?: string, hex?: string, name?: string) => {
		const code = decimal === undefined ? (hex === undefined ? undefined : Number.parseInt(hex, 16)) : Number.parseInt(decimal, 10);
		const decoded = code === undefined ? (ENTITIES[name ?? ''] ?? entity) : character(code, entity);
		return decoded;
	});
	return text;
}

/** JavaScript (`\u0020`, `\u{20}`, `\x20`) and CSS (`\20 `) escapes decoded, so text a script or style writes is read as shown; a backslash before any other hex digit is read the CSS way. */
function decodeEscapes(source: string): string {
	const text = source.replace(ESCAPE, (sequence: string, braced?: string, unicode?: string, byte?: string, css?: string) => character(Number.parseInt(braced ?? unicode ?? byte ?? css ?? '', 16), sequence));
	return text;
}

function character(code: number, written: string): string {
	const decoded = code > LAST_CODE_POINT ? written : String.fromCodePoint(code);
	return decoded;
}

function collapse(text: string): string {
	const collapsed = text.replace(/\s+/gu, ' ').trim();
	return collapsed;
}
