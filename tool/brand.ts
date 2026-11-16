import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
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

/** The brand rules on the built site: tokens only in stylesheets, one ink band per page plus the footer, and the social image's size. */
export function brandFindings(dist: string): readonly Finding[] {
	const sheets = files(dist, '.css').map((file) => ({ file: relative(dist, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
	const pages = files(dist, '.html').map((file) => ({ file: relative(dist, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
	const findings = [...sheets.flatMap(stylesheetFindings), ...pages.flatMap(bandFindings), ...socialFindings(dist)];
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

/** Display type belongs to the home hero only. */
export function displayFindings(path: string, text: string): readonly Finding[] {
	const position = text.indexOf(DISPLAY);
	const findings = path.startsWith('src/') && path !== DISPLAY_OWNER && position >= 0 ? [{ file: path, line: lineAt(text, position), rule: 'brand', fix: 'display type is for the home hero only', section: SECTION }] : [];
	return findings;
}

/** The social preview is a 1280 × 640 PNG. */
function socialFindings(dist: string): readonly Finding[] {
	const path = join(dist, SOCIAL);
	const image = existsSync(path) ? readFileSync(path) : undefined;
	const sized = image !== undefined && image.subarray(0, 8).toString('hex') === PNG_SIGNATURE && image.readUInt32BE(16) === SOCIAL_SIZE.width && image.readUInt32BE(20) === SOCIAL_SIZE.height;
	const findings = sized ? [] : [{ file: `public/${SOCIAL}`, line: 1, rule: 'brand', fix: 'the social preview must be a 1280 × 640 PNG: run node tool/social.ts', section: SECTION }];
	return findings;
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
