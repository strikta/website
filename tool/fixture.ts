import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { exportDigest, sha256 } from './export.ts';

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
