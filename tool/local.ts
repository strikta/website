import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import * as zod from 'zod';

/** The gitignored `.guard.local.yaml`: production hosts and private terms that must never leave the machine. */
export type Local = { readonly present: boolean; readonly hosts: readonly string[]; readonly terms: readonly string[] };

const localSchema = zod
	.object({ hosts: zod.array(zod.string().min(1)).default([]), private_terms: zod.array(zod.string().trim().min(1)).default([]) })
	.strict();

/** The top level of the working tree this tool file belongs to. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The settings of `.guard.local.yaml`; empty lists when the file is absent. */
export function localSettings(directory: string): Local {
	const path = resolve(directory, '.guard.local.yaml');
	const present = existsSync(path);
	const settings = present ? localSchema.parse(parse(readFileSync(path, 'utf8')) ?? {}) : { hosts: [], private_terms: [] };
	const local = { present, hosts: settings.hosts, terms: settings.private_terms };
	return local;
}
