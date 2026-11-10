import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';

const ROOT_SIZE = 16;
const pair = zod.tuple([zod.number(), zod.number()]);
const palette = zod.record(zod.string(), zod.string());
const tokenSchema = zod.object({
	color: zod.object({ light: palette, dark: palette }),
	font: zod.record(zod.string(), zod.object({ family: zod.string() })),
	fluid: zod.object({ min: zod.number(), max: zod.number() }),
	type_px: zod.record(zod.string(), pair),
	leading: zod.record(zod.string(), zod.number()),
	space_px: zod.array(zod.number()),
	line_px: zod.record(zod.string(), zod.number()),
	grid: zod.object({ columns: zod.record(zod.string(), zod.number()), gutter_px: zod.number(), margin: zod.string(), prose_ch: zod.number() }),
	target_px: zod.number()
});

type Tokens = zod.infer<typeof tokenSchema>;

/**
 * The CSS custom properties of `data/tokens.yaml`: colours by system mode (always light in print), type sizes that scale
 * between the fluid widths, space, lines, a zero radius and the column count by width. `.scheme-dark` holds the dark
 * colours for the black brand bands in either mode.
 */
export function tokenStyle(root: string): string {
	const tokens = tokenSchema.parse(parse(readFileSync(join(root, 'data', 'tokens.yaml'), 'utf8')));
	const dark = colours(tokens.color.dark);
	const style = [
		block(':root', ['color-scheme: light dark;', ...colours(tokens.color.light), ...type(tokens), ...space(tokens)]),
		`@media (prefers-color-scheme: dark) {\n${block(':root', dark)}}\n`,
		block('.scheme-dark', ['color-scheme: dark;', ...dark]),
		...columns(tokens),
		`@media print {\n${block(':root', ['color-scheme: light;', ...colours(tokens.color.light)])}}\n`
	].join('');
	return style;
}

function colours(colour: Readonly<Record<string, string>>): readonly string[] {
	const properties = Object.entries(colour).map(([name, value]) => `--s-color-${name.replaceAll('_', '-')}: ${value};`);
	return properties;
}

function type(tokens: Tokens): readonly string[] {
	const sizes = Object.entries(tokens.type_px).map(([name, [smallest, largest]]) => `--s-text-${name}: ${fluid(smallest, largest, tokens.fluid)};`);
	const leading = Object.entries(tokens.leading).map(([name, value]) => `--s-leading-${name}: ${String(value)};`);
	const fonts = Object.entries(tokens.font).map(([name, font]) => `--s-font-${name}: ${font.family};`);
	const properties = [...sizes, ...leading, ...fonts];
	return properties;
}

function space(tokens: Tokens): readonly string[] {
	const steps = tokens.space_px.map((value, step) => `--s-space-${String(step)}: ${rem(value)};`);
	const lines = Object.entries(tokens.line_px).map(([name, value]) => `--s-line-${name}: ${String(value)}px;`);
	const { gutter_px: gutter, margin, prose_ch: prose } = tokens.grid;
	const layout = ['--s-radius: 0;', `--s-target: ${String(tokens.target_px)}px;`, `--s-gutter: ${rem(gutter)};`, `--s-margin: ${margin};`, `--s-prose: ${String(prose)}ch;`];
	const properties = [...steps, ...lines, ...layout];
	return properties;
}

function columns(tokens: Tokens): readonly string[] {
	const widths = Object.entries(tokens.grid.columns).sort(([first], [second]) => Number(first) - Number(second));
	const rules = widths.map(([width, count]) => {
		const rule = block(':root', [`--s-columns: ${String(count)};`]);
		const scoped = width === '0' ? rule : `@media (min-width: ${width}rem) {\n${rule}}\n`;
		return scoped;
	});
	return rules;
}

/** A size that grows linearly from its smallest value at the narrowest fluid width to its largest at the widest. */
function fluid(smallest: number, largest: number, range: Tokens['fluid']): string {
	if (smallest === largest) {
		const fixed = rem(smallest);
		return fixed;
	}
	const slope = (largest - smallest) / (range.max - range.min);
	const intercept = (smallest - slope * range.min) / ROOT_SIZE;
	const size = `clamp(${rem(smallest)}, ${intercept.toFixed(4)}rem + ${(slope * 100).toFixed(4)}vw, ${rem(largest)})`;
	return size;
}

function rem(pixels: number): string {
	const size = `${String(pixels / ROOT_SIZE)}rem`;
	return size;
}

function block(selector: string, properties: readonly string[]): string {
	const css = `${selector} {\n${properties.map((property) => `\t${property}\n`).join('')}}\n`;
	return css;
}
