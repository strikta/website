import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';

const stageSchema = zod
	.object({
		current: zod.string().min(1),
		routes: zod.array(zod.object({ path: zod.string().startsWith('/'), stages: zod.array(zod.string()) }).strict()),
		priced: zod.array(zod.string()).default([]),
		withheld: zod.array(zod.object({ route: zod.string().startsWith('/'), stages: zod.array(zod.string()), quotes: zod.array(zod.string().min(1)) }).strict()).default([])
	})
	.strict();

export type Stage = zod.infer<typeof stageSchema>;

/** The stage table in `data/stage.yaml`, or undefined while there is none. */
export function loadStage(root: string): Stage | undefined {
	const path = join(root, 'data', 'stage.yaml');
	const table = existsSync(path) ? stageSchema.parse(parse(readFileSync(path, 'utf8'))) : undefined;
	return table;
}

// Builds run from the repository root; import.meta.url points into the bundle, so never resolve data from it.
const stage = loadStage(process.cwd());

/** The route entries of the current stage: paths, `/prefix/**` trees and files such as `/.well-known/security.txt`. */
export function stageRoutes(table: Stage): readonly string[] {
	const paths = table.routes.filter((route) => route.stages.includes(table.current)).map((route) => route.path);
	return paths;
}

/** Whether the current stage holds back an exported quote on a page route; it is still shown and checked on its other pages. */
export function withheld(table: Stage, route: string, quote: string): boolean {
	const held = table.withheld.some((entry) => entry.route === route && entry.stages.includes(table.current) && entry.quotes.includes(quote));
	return held;
}

/** Whether the current stage publishes price figures. */
export function priced(table: Stage): boolean {
	const publishes = table.priced.includes(table.current);
	return publishes;
}

/** Whether a route entry covers a built page route. */
export function covers(entry: string, route: string): boolean {
	const prefix = entry.endsWith('/**') ? entry.slice(0, -3) : undefined;
	const covered = prefix === undefined ? entry === route && extname(entry) === '' : route === prefix || route.startsWith(`${prefix}/`);
	return covered;
}

/** Whether the current stage shows an exported quote on a page route. */
export function shown(route: string, quote: string): boolean {
	const visible = stage !== undefined && !withheld(stage, route, quote);
	return visible;
}

/** Whether the current stage builds a page route; links to pages outside it are left out. */
export function staged(route: string): boolean {
	const inStage = stage !== undefined && stageRoutes(stage).some((entry) => covers(entry, route));
	return inStage;
}
