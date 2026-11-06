import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import * as zod from 'zod';

const localSchema = zod.object({ hosts: zod.array(zod.string().min(1)).default([]) }).strict();

/** The top level of the working tree this tool file belongs to. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Host names from the gitignored `.guard.local.yaml`; none when the file is absent. */
export function localHosts(directory: string): readonly string[] {
	const path = resolve(directory, '.guard.local.yaml');
	const settings = existsSync(path) ? localSchema.parse(parse(readFileSync(path, 'utf8')) ?? {}) : { hosts: [] };
	const { hosts } = settings;
	return hosts;
}
