import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import { stringify } from 'yaml';
import { exportDigest, sha256 } from './export.ts';

const GIT_VARIABLE = /^GIT_/u;

type SyntheticQuote = { readonly id: string; readonly text: string; readonly pages: readonly string[]; readonly fills?: Readonly<Record<string, string>> };

/** A fresh synthetic working tree under the temporary folder, with a function that removes it. */
export function workspace(files: Readonly<Record<string, string>>): { directory: string; remove: () => void } {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), 'website-')));
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(directory, path)), { recursive: true });
		writeFileSync(join(directory, path), content);
	}
	const tree = { directory, remove: (): void => { rmSync(directory, { recursive: true, force: true }); } };
	return tree;
}

/** The files of a synthetic `content/export/`, hashed the way the private export hashes them. */
export function syntheticExport(legal: Readonly<Record<string, string>>, quotes: readonly SyntheticQuote[]): Record<string, string> {
	const files = Object.entries(legal).map(([path, content]) => ({ path, version: '1.0', sha256: sha256(content) }));
	const index = {
		schema: 1,
		export_sha256: exportDigest(files),
		files,
		quotes: quotes.map((quote) => ({ ...quote, sha256: sha256(quote.text), source: { kind: 'decided-copy' }, fills: quote.fills ?? {} }))
	};
	const exported = Object.fromEntries(Object.entries(legal).map(([path, content]) => [`content/export/${path}`, content] as const));
	const tree = { 'content/export/quotes.yaml': stringify(index), ...exported };
	return tree;
}

/** The process environment without git's `GIT_*` variables, which a git hook exports and which would point a spawned git at the hooked repository instead of its working folder. */
export function isolated(): NodeJS.ProcessEnv {
	const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_VARIABLE.test(name)));
	return environment;
}

/** Removes the `GIT_*` variables from this test process, so git run in process acts on the folder it is given. */
export function unhook(): void {
	for (const name of Object.keys(process.env).filter((variable) => GIT_VARIABLE.test(variable))) {
		vi.stubEnv(name, undefined);
	}
}
