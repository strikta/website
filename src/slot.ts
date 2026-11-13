import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import * as zod from 'zod';

export type Slots = Readonly<Record<string, unknown>>;

const SLOT_FILES: readonly { readonly path: string; readonly namespace?: string }[] = [
	{ path: 'data/site.yaml' },
	{ path: 'data/offer.yaml' },
	{ path: 'data/merchant.yaml' },
	{ path: 'data/h2h/results.yaml', namespace: 'h2h' },
	{ path: 'content/export/company.yaml' },
	{ path: 'content/export/pro.yaml' }
];
const documentSchema = zod.record(zod.string(), zod.unknown());

// Builds run from the repository root; import.meta.url points into the bundle, so never resolve data from it.
export const slots = loadSlots(process.cwd());

/** Every slot fact from `data/` and the export's fact files, keyed by its top-level name (`launch`, `company`, `h2h` …). */
export function loadSlots(root: string): Slots {
	const documents = SLOT_FILES.map((file) => slotDocument(root, file.path, file.namespace));
	const slots: Record<string, unknown> = {};
	for (const document of documents) {
		const repeated = Object.keys(document).filter((key) => key in slots);
		if (repeated.length > 0) {
			throw new Error(`Slot names defined twice in data/ or content/export/: ${repeated.join(', ')}`);
		}
		Object.assign(slots, document);
	}
	return slots;
}

/** The filled value of a slot such as `launch.date`; an unfilled slot fails the build. */
export function slot(slots: Slots, name: string): string {
	const value = optionalSlot(slots, name);
	if (value === undefined) {
		throw new Error(`Unfilled slot {${name}}: fill it in data/ or hide the section by stage, never with a default.`);
	}
	return value;
}

/** The value of a slot, or undefined while it is unfilled. */
export function optionalSlot(slots: Slots, name: string): string | undefined {
	const value = name.split('.').reduce<unknown>((parent, key) => (isRecord(parent) ? parent[key] : undefined), slots);
	const filled = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
	return filled;
}

function slotDocument(directory: string, path: string, namespace?: string): Slots {
	const location = join(directory, path);
	const document = existsSync(location) ? documentSchema.parse(parse(readFileSync(location, 'utf8')) ?? {}) : {};
	const slots = namespace === undefined ? document : { [namespace]: document };
	return slots;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	const record = typeof value === 'object' && value !== null && !Array.isArray(value);
	return record;
}
