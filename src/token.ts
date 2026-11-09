import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';

const pair = zod.tuple([zod.number(), zod.number()]);
const columnSchema = zod.object({ min: zod.number().optional(), cols: zod.number(), gutter: zod.number(), max: zod.number().optional() });
const tokenSchema = zod.object({
	color: zod.object({ light: zod.record(zod.string(), zod.string()), dark: zod.record(zod.string(), zod.string()) }),
	type_px: zod.record(zod.string(), pair),
	space_px: zod.array(zod.number()),
	radius_px: zod.record(zod.string(), zod.number()),
	grid: zod.object({ sm: columnSchema, md: columnSchema, lg: columnSchema }),
	target_px: zod.number()
});

type Tokens = zod.infer<typeof tokenSchema>;
type Column = zod.infer<typeof columnSchema>;

/** The CSS custom properties of `data/tokens.yaml`: colours by system mode, type, space, radius and the grid by width. */
export function tokenStyle(root: string): string {
	const tokens = tokenSchema.parse(parse(readFileSync(join(root, 'data', 'tokens.yaml'), 'utf8')));
	const { sm, md, lg } = tokens.grid;
	const base = [...colours(tokens.color.light), ...scale(tokens), ...grid(sm), `--grid-max: ${String(lg.max ?? 0)}px;`];
	const style = [
		block(':root', ['color-scheme: light dark;', ...base]),
		`@media (prefers-color-scheme: dark) {\n${block(':root', colours(tokens.color.dark))}}\n`,
		`@media (min-width: ${String(md.min ?? 0)}px) {\n${block(':root', grid(md))}}\n`,
		`@media (min-width: ${String(lg.min ?? 0)}px) {\n${block(':root', grid(lg))}}\n`
	].join('');
	return style;
}

function colours(palette: Readonly<Record<string, string>>): readonly string[] {
	const properties = Object.entries(palette).map(([name, value]) => `--${name.replaceAll('_', '-')}: ${value};`);
	return properties;
}

function scale(tokens: Tokens): readonly string[] {
	const type = Object.entries(tokens.type_px).flatMap(([name, [size, line]]) => [`--${name.replaceAll('_', '-')}-size: ${String(size)}px;`, `--${name.replaceAll('_', '-')}-line: ${String(line)}px;`]);
	const space = tokens.space_px.map((value, step) => `--space-${String(step)}: ${String(value)}px;`);
	const radius = Object.entries(tokens.radius_px).map(([name, value]) => `--radius-${name}: ${String(value)}px;`);
	const properties = [...type, ...space, ...radius, `--target: ${String(tokens.target_px)}px;`];
	return properties;
}

function grid(column: Column): readonly string[] {
	const properties = [`--cols: ${String(column.cols)};`, `--gutter: ${String(column.gutter)}px;`];
	return properties;
}

function block(selector: string, properties: readonly string[]): string {
	const css = `${selector} {\n${properties.map((property) => `\t${property}\n`).join('')}}\n`;
	return css;
}
