import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { exportFindings } from './export.ts';
import { syntheticExport, workspace } from './fixture.ts';

const legal = { 'legal/terms.md': '# Synthetic terms\n\n## 1. Scope\n1.1 Synthetic clause.\n' };
const quotes = [{ id: 'synthetic-line', text: 'A synthetic decided line.', pages: ['/'] }];

function fixes(change: (directory: string) => void): readonly string[] {
	const tree = workspace(syntheticExport(legal, quotes));
	change(tree.directory);
	const found = exportFindings(join(tree.directory, 'content/export'), 'content/export').map((finding) => finding.fix);
	tree.remove();
	return found;
}

test('an untouched export passes', () => {
	expect(fixes(() => undefined)).toEqual([]);
});

test('a hand edit to an exported file fails', () => {
	expect(fixes((directory) => { appendFileSync(join(directory, 'content/export/legal/terms.md'), 'Improved.\n'); })).toEqual([
		'changed or missing since the export: regenerate the export in the private repository'
	]);
});

test('a hand edit to a quote fails', () => {
	const edit = (directory: string): void => {
		const index = join(directory, 'content/export/quotes.yaml');
		writeFileSync(index, syntheticExport(legal, quotes)['content/export/quotes.yaml']?.replace('A synthetic decided line.', 'A better line.') ?? '');
	};
	expect(fixes(edit)).toContain('quote "synthetic-line" changed since the export: regenerate the export in the private repository');
});

test('a file added by hand fails', () => {
	expect(fixes((directory) => { writeFileSync(join(directory, 'content/export/legal/extra.md'), 'Synthetic.\n'); })).toEqual([
		'not listed in the export: regenerate the export in the private repository'
	]);
});

test('no export yet means nothing to check', () => {
	const tree = workspace({ 'README.md': 'Synthetic.\n' });
	expect(exportFindings(join(tree.directory, 'content/export'), 'content/export')).toEqual([]);
	tree.remove();
});

test('a file quote that is not verbatim in its file fails', () => {
	const tree = workspace(syntheticExport(legal, [{ id: 'synthetic-clause', text: '1.1 Synthetic clause.', pages: ['/'], source: { file: 'legal/terms.md' } }, { id: 'synthetic-other', text: '1.2 Missing clause.', pages: ['/'], source: { file: 'legal/terms.md' } }]));
	const found = exportFindings(join(tree.directory, 'content/export'), 'content/export').map((finding) => finding.fix);
	tree.remove();
	expect(found).toEqual(['quote "synthetic-other" is not verbatim in its source file: regenerate the export in the private repository']);
});
