import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { parse } from 'yaml';
import * as zod from 'zod';
import { type Finding, lineAt } from './finding.ts';

type Sheet = { readonly file: string; readonly text: string };

const SECTION = 'Code standards (TypeScript and .astro)';
/** The compiled design tokens: the one stylesheet that holds raw values. */
const TOKEN_SHEET = 'token.css';
/** Raw lengths a stylesheet may hold: the mark's slit, half its 3-unit width, in the mark's own units. */
const ALLOWED_LENGTHS: ReadonlySet<string> = new Set(['1.5px']);
const SQUARE_RADII: ReadonlySet<string> = new Set(['0', '0px', 'var(--s-radius)']);
const SYSTEM_ANGLE = 'var(--s-angle)';
const HEX = /#[0-9a-f]{3,8}\b/giu;
const LENGTH = /(?<![\w.-])\d*\.?\d+px\b/gu;
const RADIUS = /border-radius\s*:\s*(?<value>[^;}]+)/gu;
const SHADOW = /box-shadow\s*:\s*(?<value>[^;}]+)/gu;
// The argument may hold one level of parentheses, as `var(--s-angle)` does.
const TURN = /(?:rotate|skew)[XYZ]?\((?<value>(?:[^()]|\([^()]*\))*)\)/gu;
const MOMENT = /<(?<tag>[a-z]+)\b[^>]*\bclass="[^"]*\bs-brand-moment\b[^"]*"/gu;
const DISPLAY = '--s-text-display';
/** The one component allowed to set display type: the home hero. */
const DISPLAY_OWNER = 'src/components/Hero.astro';
const SOCIAL = 'brand/social.png';
const SOCIAL_SIZE = { width: 1280, height: 640 };
const PNG_SIGNATURE = '89504e470d0a1a0a';
/** The social preview's PNG layout: 8-bit truecolour, three bytes a pixel. */
const RGB = { depth: 8, colour: 2, channels: 3 };
/** A pixel counts as grey when its channels differ by at most this much. */
const GREY_SPREAD = 2;
const tokenSchema = zod.object({ color: zod.object({ light: zod.object({ ink: zod.string(), paper: zod.string() }) }) });

type Pixels = { readonly width: number; readonly height: number; readonly data: Uint8Array };

/** The brand rules on the built site: tokens only in stylesheets, one ink band per page plus the footer, and the social image's size and palette. */
export function brandFindings(dist: string, root: string): readonly Finding[] {
	const sheets = files(dist, '.css').map((file) => ({ file: relative(dist, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
	const pages = files(dist, '.html').map((file) => ({ file: relative(dist, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
	const findings = [...sheets.flatMap(stylesheetFindings), ...pages.flatMap(bandFindings), ...socialFindings(dist, root)];
	return findings;
}

/** A stylesheet other than the compiled tokens holds no literal colour or length outside the allowlist, no radius, shadow or angle but the system's. */
export function stylesheetFindings(sheet: Sheet): readonly Finding[] {
	if (basename(sheet.file) === TOKEN_SHEET) {
		return [];
	}
	const findings = [
		...matched(sheet, HEX, () => true, 'a literal colour: use a --s-color token'),
		...matched(sheet, LENGTH, (value) => !ALLOWED_LENGTHS.has(value), 'a literal px length: use a --s-space or --s-line token'),
		...matched(sheet, RADIUS, (value) => !SQUARE_RADII.has(value.trim()), 'a radius: corners are square'),
		...matched(sheet, SHADOW, (value) => value.trim() !== 'none', 'a shadow: the brand has no elevation'),
		...matched(sheet, TURN, (value) => value.trim() !== SYSTEM_ANGLE, 'a rotation or skew: 1:6 is the only angle, var(--s-angle)')
	];
	return findings;
}

/** A page holds at most one ink brand band besides the footer's. */
export function bandFindings(page: Sheet): readonly Finding[] {
	const bands = [...page.text.matchAll(MOMENT)].filter((match) => match.groups?.['tag'] !== 'footer');
	const findings = bands.slice(1).map((band) => ({ file: page.file, line: lineAt(page.text, band.index), rule: 'brand', fix: 'a second ink band: one per page, plus the footer', section: SECTION }));
	return findings;
}

/** Display type belongs to the home hero only; a unit test may name the token it checks. */
export function displayFindings(path: string, text: string): readonly Finding[] {
	const position = text.indexOf(DISPLAY);
	const findings = path.startsWith('src/') && !path.endsWith('.test.ts') && path !== DISPLAY_OWNER && position >= 0 ? [{ file: path, line: lineAt(text, position), rule: 'brand', fix: 'display type is for the home hero only', section: SECTION }] : [];
	return findings;
}

/** The social preview is a 1280 × 640 PNG in the brand's palette. */
function socialFindings(dist: string, root: string): readonly Finding[] {
	const path = join(dist, SOCIAL);
	const image = existsSync(path) ? readFileSync(path) : undefined;
	const sized = image !== undefined && image.subarray(0, 8).toString('hex') === PNG_SIGNATURE && image.readUInt32BE(16) === SOCIAL_SIZE.width && image.readUInt32BE(20) === SOCIAL_SIZE.height;
	const fixes = image !== undefined && sized ? [paletteFix(decodePng(image), root)] : ['the social preview must be a 1280 × 640 PNG: run node tool/social.ts'];
	const findings = fixes.filter((fix) => fix !== undefined).map((fix) => ({ file: `public/${SOCIAL}`, line: 1, rule: 'brand', fix, section: SECTION }));
	return findings;
}

/** Why an image is off the brand's palette, or undefined: every pixel grey, the darkest the ink token and the lightest the paper token. */
function paletteFix(pixels: Pixels | undefined, root: string): string | undefined {
	if (pixels === undefined) {
		return 'the social preview must be an 8-bit RGB PNG: run node tool/social.ts';
	}
	const { ink, paper } = tokenSchema.parse(parse(readFileSync(join(root, 'data', 'tokens.yaml'), 'utf8'))).color.light;
	const levels = greyLevels(pixels.data);
	const darkest = levels === undefined ? undefined : Math.min(...levels);
	const lightest = levels === undefined ? undefined : Math.max(...levels);
	const fix = levels === undefined ? 'the social preview holds a colour: it is ink, grain and paper only' : darkest === channel(ink) && lightest === channel(paper) ? undefined : `the social preview's background must be the ink token ${ink} and its lockup the paper token ${paper}: run node tool/social.ts`;
	return fix;
}

/** The distinct grey levels of RGB pixel data, or undefined when a pixel is not grey. */
function greyLevels(data: Uint8Array): ReadonlySet<number> | undefined {
	const levels = new Set<number>();
	for (let offset = 0; offset < data.length; offset += RGB.channels) {
		const red = data[offset] ?? 0;
		const green = data[offset + 1] ?? 0;
		const blue = data[offset + 2] ?? 0;
		if (Math.max(red, green, blue) - Math.min(red, green, blue) > GREY_SPREAD) {
			return undefined;
		}
		levels.add(green);
	}
	return levels;
}

/** The grey level of a `#RRGGBB` token whose channels are equal. */
function channel(hex: string): number {
	const level = Number.parseInt(hex.slice(3, 5), 16);
	return level;
}

/** The pixels of a non-interlaced 8-bit RGB PNG, or undefined for any other layout. */
function decodePng(image: Buffer): Pixels | undefined {
	const header = chunks(image).find(({ type }) => type === 'IHDR')?.data;
	if (header === undefined || header.readUInt8(8) !== RGB.depth || header.readUInt8(9) !== RGB.colour || header.readUInt8(12) !== 0) {
		return undefined;
	}
	const width = header.readUInt32BE(0);
	const height = header.readUInt32BE(4);
	const packed = inflateSync(Buffer.concat(chunks(image).filter(({ type }) => type === 'IDAT').map(({ data }) => data)));
	const pixels = { width, height, data: unfiltered(packed, width * RGB.channels, height) };
	return pixels;
}

function chunks(image: Buffer): readonly { type: string; data: Buffer }[] {
	const found: { type: string; data: Buffer }[] = [];
	for (let offset = 8; offset + 8 <= image.length; ) {
		const length = image.readUInt32BE(offset);
		found.push({ type: image.toString('latin1', offset + 4, offset + 8), data: image.subarray(offset + 8, offset + 8 + length) });
		offset += length + 12;
	}
	return found;
}

/** Undoes the PNG row filters (none, sub, up, average, Paeth) into raw pixel bytes. */
function unfiltered(packed: Buffer, stride: number, height: number): Uint8Array {
	const data = new Uint8Array(stride * height);
	for (let row = 0; row < height; row += 1) {
		const filter = packed[row * (stride + 1)] ?? 0;
		for (let column = 0; column < stride; column += 1) {
			const left = column >= RGB.channels ? (data[row * stride + column - RGB.channels] ?? 0) : 0;
			const above = row > 0 ? (data[(row - 1) * stride + column] ?? 0) : 0;
			const corner = row > 0 && column >= RGB.channels ? (data[(row - 1) * stride + column - RGB.channels] ?? 0) : 0;
			const byte = packed[row * (stride + 1) + 1 + column] ?? 0;
			data[row * stride + column] = (byte + predicted(filter, left, above, corner)) % 256;
		}
	}
	return data;
}

function predicted(filter: number, left: number, above: number, corner: number): number {
	const estimate = left + above - corner;
	const [nearest = 0] = [left, above, corner].sort((first, second) => Math.abs(estimate - first) - Math.abs(estimate - second));
	const predictions: Readonly<Record<number, number>> = { 0: 0, 1: left, 2: above, 3: Math.floor((left + above) / 2), 4: nearest };
	const prediction = predictions[filter] ?? 0;
	return prediction;
}

function matched(sheet: Sheet, pattern: RegExp, offending: (value: string) => boolean, fix: string): readonly Finding[] {
	const findings = [...sheet.text.matchAll(pattern)].flatMap((match) => {
		const [whole] = match;
		const found = offending(match.groups?.['value'] ?? whole) ? [{ file: sheet.file, line: lineAt(sheet.text, match.index), rule: 'brand', fix: `"${whole.slice(0, 40)}": ${fix}`, section: SECTION }] : [];
		return found;
	});
	return findings;
}

function files(directory: string, extension: string): readonly string[] {
	const found = readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(extension))
		.map((entry) => join(entry.parentPath, entry.name));
	return found;
}
