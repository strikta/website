import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';
import { slot, type Slots } from './slot.ts';

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

export type Export = zod.infer<typeof exportSchema>;
export type Quote = Export['quotes'][number];

/** The generated export in a directory such as `content/export/`, or undefined before the first export. */
export function loadExport(directory: string): Export | undefined {
	const path = join(directory, 'quotes.yaml');
	const exported = existsSync(path) ? exportSchema.parse(parse(readFileSync(path, 'utf8'))) : undefined;
	return exported;
}

/** A quote's text with each placeholder replaced by the slot the export maps it to. */
export function filledText(quote: Quote, slots: Slots): string {
	const filled = Object.entries(quote.fills).reduce((text, [placeholder, name]) => text.replaceAll(placeholder, slot(slots, name)), quote.text);
	return filled;
}
