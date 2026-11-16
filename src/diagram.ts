import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';
import { covers, loadStage, stageRoutes } from './stage.ts';

/** Hand-written values from the brand guide, until the demo generator writes them from a real run. */
const HAND_WRITTEN = 'brand-guide';
/** The route whose stage publishes the release, from which every diagram must come from a real run. */
const RELEASED = '/docs';

const source = zod.enum(['demo', HAND_WRITTEN]);
const sectionSchema = zod.object({ name: zod.string().min(1), start: zod.number().int().nonnegative(), end: zod.number().int().nonnegative(), selected: zod.boolean().optional() }).strict();
const candidateSchema = zod.object({ id: zod.string().min(1), served: zod.boolean(), stage: zod.string().min(1).optional(), text: zod.string().min(1).optional() }).strict();
const turnSchema = zod.object({ turn: zod.string().min(1), source, sections: zod.array(sectionSchema).min(1), candidates: zod.array(candidateSchema).default([]) }).strict();
const replaySchema = zod.object({ source, from: zod.string(), to: zod.string(), lines: zod.array(zod.object({ change: zod.enum(['added', 'removed']), text: zod.string().min(1) }).strict()).min(1) }).strict();
const axis = zod.number().int().min(0).max(100);
const factSchema = zod.object({ id: zod.string().min(1), state: zod.enum(['current', 'closed', 'retracted', 'superseded']), text: zod.string().min(1), start: axis, end: axis.optional(), successor: zod.string().optional() }).strict();
const factsSchema = zod.object({ source, facts: zod.array(factSchema).min(1) }).strict();
const blockSchema = zod.object({ source, rules: zod.string().min(1), dates: zod.string().min(1) }).strict();

export type Turn = zod.infer<typeof turnSchema>;
export type Replay = zod.infer<typeof replaySchema>;
export type Fact = zod.infer<typeof factSchema>;
export type Excerpt = zod.infer<typeof blockSchema>;

/** The synthetic turns that the window diagrams draw, from `data/window.yaml`. */
function loadTurns(root: string): readonly Turn[] {
	const turns = zod.array(turnSchema).min(1).parse(readData(root, 'window.yaml'));
	turns.forEach((turn) => {
		generated(root, 'window.yaml', turn.source);
	});
	return turns;
}

/** One synthetic turn, or a build failure that says how to fix it. */
export function findTurn(root: string, identifier: string): Turn {
	const found = loadTurns(root).find(({ turn }) => turn === identifier);
	if (found === undefined) {
		throw new Error(`No turn ${identifier} in data/window.yaml: add it, or run the demo generator.`);
	}
	return found;
}

/** The replay diff between two synthetic turns, from `data/replay.yaml`. */
export function loadReplay(root: string): Replay {
	const replay = replaySchema.parse(readData(root, 'replay.yaml'));
	generated(root, 'replay.yaml', replay.source);
	return replay;
}

/** The synthetic facts in their states, from `data/fact.yaml`. */
export function loadFacts(root: string): readonly Fact[] {
	const { source: origin, facts } = factsSchema.parse(readData(root, 'fact.yaml'));
	generated(root, 'fact.yaml', origin);
	return facts;
}

/** The synthetic window text of the standing-rules block and the dates, from `data/block.yaml`. */
export function loadExcerpt(root: string): Excerpt {
	const excerpt = blockSchema.parse(readData(root, 'block.yaml'));
	generated(root, 'block.yaml', excerpt.source);
	return excerpt;
}

/** Real product output on the synthetic persona, such as `demo/inspect-turn.txt`, or a build failure that says how to fix it. */
export function loadDemo(root: string, file: string): string {
	const path = join(root, 'demo', file);
	if (!existsSync(path)) {
		throw new Error(`No demo/${file}: the release stage shows real output; run the demo generator at the release tag.`);
	}
	const output = readFileSync(path, 'utf8').trimEnd();
	return output;
}

/** The `/diagram.css` rules: each window's row heights proportional to bytes with its row count, and each fact's validity. */
export function diagramStyles(root: string): string {
	const windows = loadTurns(root).map(({ turn, sections }) => {
		const tracks = sections.map(({ start, end }) => `minmax(var(--s-space-4), ${String(end - start + 1)}fr)`).join(' ');
		const rule = `.window[data-turn="${turn}"] { grid-template-rows: ${tracks}; --count: ${String(sections.length)}; }`;
		return rule;
	});
	const facts = loadFacts(root).map(({ id, start, end }) => `[data-fact="${id}"] { --start: ${String(start)}; --end: ${String(end ?? 100)}; }`);
	const stylesheet = `${[...windows, ...facts].join('\n')}\n`;
	return stylesheet;
}

function readData(root: string, file: string): unknown {
	const path = join(root, 'data', file);
	if (!existsSync(path)) {
		throw new Error(`No data/${file}: the diagrams need it; run the demo generator.`);
	}
	const document: unknown = parse(readFileSync(path, 'utf8'));
	return document;
}

/** Fails the build when a stage that publishes the release would still draw a hand-written diagram. */
function generated(root: string, file: string, origin: string): void {
	const table = loadStage(root);
	const releasing = table !== undefined && stageRoutes(table).some((entry) => covers(entry, RELEASED));
	if (releasing && origin === HAND_WRITTEN) {
		throw new Error(`data/${file} is still marked source: ${HAND_WRITTEN}: run the demo generator before the release stage.`);
	}
}
