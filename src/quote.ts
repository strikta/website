import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from 'yaml';
import * as zod from 'zod';
import { slot, slots, type Slots } from './slot.ts';

const sha256 = zod.string().regex(/^[0-9a-f]{64}$/u);
const exportSchema = zod
	.object({
		schema: zod.literal(1),
		export_sha256: sha256,
		files: zod.array(zod.object({ path: zod.string().min(1), version: zod.string().optional(), sha256 }).strict()),
		quotes: zod.array(
			zod
				.object({
					id: zod.string().min(1),
					text: zod.string().min(1),
					sha256,
					source: zod.union([zod.object({ file: zod.string(), clause: zod.string().optional() }).strict(), zod.object({ kind: zod.literal('decided-copy') }).strict()]),
					pages: zod.array(zod.string().startsWith('/')),
					fills: zod.record(zod.string(), zod.string()).default({})
				})
				.strict()
		)
	})
	.strict();
const INDEX = 'quotes.yaml';

export type Export = zod.infer<typeof exportSchema>;
export type Quote = Export['quotes'][number];

// Builds run from the repository root; import.meta.url points into the bundle, so never resolve data from it.
const exportDirectory = join(process.cwd(), 'content', 'export');
const exported = loadExport(exportDirectory);

/** The generated export in a directory such as `content/export/`, or undefined before the first export. */
export function loadExport(directory: string): Export | undefined {
	const path = join(directory, INDEX);
	const loaded = existsSync(path) ? exportSchema.parse(parse(readFileSync(path, 'utf8'))) : undefined;
	return loaded;
}

/** Why a `quotes.yaml` text does not parse as an export; empty when it does. */
export function exportProblems(text: string): readonly string[] {
	const document = parseDocument(text);
	const syntax = document.errors.map((error) => error.message);
	const parsed = syntax.length > 0 ? undefined : exportSchema.safeParse(document.toJS());
	const schema = parsed === undefined || parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
	const problems = [...syntax, ...schema];
	return problems;
}

/** A quote's text with each placeholder replaced by the slot the export maps it to. */
export function filledText(entry: Quote, filling: Slots): string {
	const filled = Object.entries(entry.fills).reduce((text, [placeholder, name]) => text.replaceAll(placeholder, slot(filling, name)), entry.text);
	return filled;
}

/** The decided text of an exported quote, filled from the slots; a missing quote fails the build. */
export function quote(identifier: string): string {
	const entry = exported?.quotes.find((candidate) => candidate.id === identifier);
	if (entry === undefined) {
		throw new Error(`No exported quote "${identifier}": a new export is needed; never write the text here.`);
	}
	const filled = filledText(entry, slots);
	return filled;
}

/** An exported file's text with every placeholder that its quotes map to a slot filled in. */
export function exportedText(path: string): string {
	if (exported?.files.some((file) => file.path === path) !== true) {
		throw new Error(`No exported file "${path}": a new export is needed.`);
	}
	const fills = exported.quotes
		.filter((entry) => 'file' in entry.source && entry.source.file === path)
		.flatMap((entry) => Object.entries(entry.fills));
	const text = fills.reduce((content, [placeholder, name]) => content.replaceAll(placeholder, slot(slots, name)), readFileSync(join(exportDirectory, path), 'utf8'));
	return text;
}

/** The version an exported file's title states, if any. */
export function exportedVersion(path: string): string | undefined {
	const version = exported?.files.find((file) => file.path === path)?.version;
	return version;
}
