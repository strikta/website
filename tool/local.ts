import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import * as zod from 'zod';

/** The gitignored `.guard.local.yaml`: production hosts and private terms that must never leave the machine; `problem` says why a present file could not be read. */
export type Local = { readonly present: boolean; readonly hosts: readonly string[]; readonly terms: readonly string[]; readonly problem?: string };

/** The name of the local guard file at the top of the working tree. */
export const LOCAL_FILE = '.guard.local.yaml';

const entries = zod.preprocess((value) => (value === '' ? undefined : value), zod.array(zod.string().trim().min(1)).default([]));
const localSchema = zod.object({ hosts: entries, private_terms: entries }).strict();
const RULE_OFF = 'the private-term rule is off';

/** The top level of the working tree this tool file belongs to. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The settings of `.guard.local.yaml`, every value read as text; empty lists when the file is absent or invalid. */
export function localSettings(directory: string): Local {
	const path = resolve(directory, LOCAL_FILE);
	const local = existsSync(path) ? parsedSettings(readFileSync(path, 'utf8')) : { present: false, hosts: [], terms: [] };
	return local;
}

/** One line on why the private-term rule is off, or undefined when the file lists private terms. */
export function localWarning(local: Local): string | undefined {
	const missing = local.present ? undefined : `${LOCAL_FILE} is missing: ${RULE_OFF}`;
	const empty = local.terms.length === 0 ? `${LOCAL_FILE} lists no private_terms: ${RULE_OFF}` : undefined;
	const warning = missing ?? (local.problem === undefined ? empty : `${local.problem}: ${RULE_OFF}`);
	return warning;
}

/** Reads every scalar as text (the YAML failsafe schema), so a phone number keeps its leading zero or plus sign. */
function parsedSettings(text: string): Local {
	const document = parseDocument(text, { schema: 'failsafe' });
	const [error] = document.errors;
	const [start] = error?.linePos ?? [];
	const local = error === undefined ? checkedSettings(document.toJS()) : invalidSettings(`line ${String(start?.line ?? 1)} (not valid YAML)`);
	return local;
}

function checkedSettings(content: unknown): Local {
	const parsed = localSchema.safeParse(content ?? {});
	const [issue] = parsed.error?.issues ?? [];
	const local = parsed.success ? { present: true, hosts: parsed.data.hosts, terms: parsed.data.private_terms } : invalidSettings(`${issue?.path.join('.') || 'the top level'}: ${issue?.message ?? 'invalid'}`);
	return local;
}

/** A present file that cannot be used; the problem names the place and the expected shape, never a value. */
function invalidSettings(place: string): Local {
	const local = { present: true, hosts: [], terms: [], problem: `${LOCAL_FILE} is invalid at ${place}` };
	return local;
}
