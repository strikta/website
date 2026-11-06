import { basename } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';
import { lineAt, type Finding } from './finding.ts';

type Kind = { readonly rule: string; readonly section: string };

const DAY_MILLISECONDS = 86_400_000;
const FOUNDING_DAYS = 90;
const COMPONENT_NAME = /^[A-Z][a-z]+\.astro$/u;
const NONTEXT = /border|focus/u;
const FOUNDING: Kind = { rule: 'founding-date', section: 'Three kinds of text' };
const CONTRAST: Kind = { rule: 'contrast', section: 'Code standards (TypeScript and .astro)' };

const day = zod.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const offerSchema = zod.object({
	launch: zod.object({ date: day.optional() }).optional(),
	founding: zod.object({ end_date: day.optional(), after_date: day.optional() }).optional()
});
const hex = zod.string().regex(/^#[0-9A-Fa-f]{6}$/u);
const tokenSchema = zod.object({
	color: zod.record(zod.string(), zod.record(zod.string(), hex)),
	contrast_tested: zod.record(zod.string(), zod.record(zod.string(), zod.number()))
});

/** `data/offer.yaml`: the founding period ends 90 days after launch and the later price starts the next day. */
export function foundingFindings(file: string, text: string): readonly Finding[] {
	const offer = offerSchema.parse(parse(text) ?? {});
	const launch = offer.launch?.date;
	const end = offer.founding?.end_date;
	const after = offer.founding?.after_date;
	const ending = end !== undefined && (launch === undefined || end !== addDays(launch, FOUNDING_DAYS));
	const starting = after !== undefined && (end === undefined || after !== addDays(end, 1));
	const findings = [
		...(ending ? [dataFinding(file, text, 'end_date', FOUNDING, `end date must be launch + ${String(FOUNDING_DAYS)} days`)] : []),
		...(starting ? [dataFinding(file, text, 'after_date', FOUNDING, 'after_date must be the day after the end date')] : [])
	];
	return findings;
}

/** `data/tokens.yaml`: every declared pair meets WCAG AA (4.5:1 for text, 3:1 for borders and focus rings). */
export function contrastFindings(file: string, text: string): readonly Finding[] {
	const tokens = tokenSchema.parse(parse(text));
	const findings = Object.entries(tokens.contrast_tested).flatMap(([mode, pairs]) =>
		Object.entries(pairs).flatMap(([pair, declared]) => pairFindings(file, text, tokens.color[mode] ?? {}, { pair, declared }))
	);
	return findings;
}

/** `src/components/`: one component per file, named in single-word PascalCase. */
export function filenameFindings(file: string): readonly Finding[] {
	const valid = COMPONENT_NAME.test(basename(file));
	const findings = valid ? [] : [{ file, line: 1, rule: 'filename', fix: 'single-word PascalCase, such as Price.astro', section: 'Code standards (TypeScript and .astro)' }];
	return findings;
}

function pairFindings(file: string, text: string, colors: Readonly<Record<string, string>>, declaration: { pair: string; declared: number }): readonly Finding[] {
	const { pair, declared } = declaration;
	const back = Object.keys(colors).find((name) => pair.endsWith(`_${name}`) && pair.slice(0, -name.length - 1) in colors);
	if (back === undefined) {
		const unknown = [dataFinding(file, text, pair, CONTRAST, `"${pair}" names no pair of declared colours`)];
		return unknown;
	}
	const fore = pair.slice(0, -back.length - 1);
	const ratio = contrast(colors[fore] ?? '', colors[back] ?? '');
	const minimum = NONTEXT.test(fore) ? 3 : 4.5;
	const findings = [
		...(ratio < minimum ? [dataFinding(file, text, pair, CONTRAST, `contrast below AA: ${ratio.toFixed(2)}:1 is under ${String(minimum)}:1`)] : []),
		...(Math.abs(ratio - declared) > 0.015 ? [dataFinding(file, text, pair, CONTRAST, `declared ${String(declared)} but the colours give ${ratio.toFixed(2)}`)] : [])
	];
	return findings;
}

function contrast(foreground: string, background: string): number {
	const [lighter = 0, darker = 0] = [luminance(foreground), luminance(background)].sort((first, second) => second - first);
	const ratio = (lighter + 0.05) / (darker + 0.05);
	return ratio;
}

function luminance(color: string): number {
	const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255);
	const [red = 0, green = 0, blue = 0] = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
	const relative = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	return relative;
}

function addDays(date: string, days: number): string {
	const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MILLISECONDS).toISOString().slice(0, 10);
	return shifted;
}

function dataFinding(file: string, text: string, key: string, kind: Kind, fix: string): Finding {
	const position = text.indexOf(`${key}:`);
	const finding = { file, line: position < 0 ? 1 : lineAt(text, position), fix, ...kind };
	return finding;
}
