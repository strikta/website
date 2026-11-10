import { appendFileSync, existsSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { syntheticExport, workspace } from './fixture.ts';
import { importExport } from './import.ts';

const legal = { 'legal/terms.md': '# Synthetic terms\n\n## 1. Scope\n1.1 Synthetic clause.\n', 'company.yaml': 'company:\n  name: ZZZ Synthetic AB\n' };
const quotes = [{ id: 'synthetic-clause', text: '1.1 Synthetic clause.', pages: ['/'], source: { file: 'legal/terms.md' } }];
const printed = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
const reported = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

afterEach(() => {
	printed.mockClear();
	reported.mockClear();
});

type Outcome = { readonly code: number; readonly output: string; readonly imported: readonly string[] };

function run(change: (source: string) => void, argv?: (source: string) => readonly string[]): Outcome {
	const exported = workspace(syntheticExport(legal, quotes));
	const repository = workspace({ 'content/export/legal/old.md': 'An older synthetic file.\n', 'README.md': 'Synthetic.\n' });
	const source = join(exported.directory, 'content/export');
	change(source);
	const code = importExport(argv?.(source) ?? [source], repository.directory);
	const target = join(repository.directory, 'content/export');
	const imported = ['quotes.yaml', 'legal/terms.md', 'company.yaml', 'legal/old.md'].filter((path) => existsSync(join(target, path)));
	const sameTerms = imported.includes('legal/terms.md') && readFileSync(join(target, 'legal/terms.md'), 'utf8') === legal['legal/terms.md'];
	exported.remove();
	repository.remove();
	const output = printed.mock.calls.map(([chunk]) => String(chunk)).join('');
	const outcome = { code, output, imported: sameTerms || !imported.includes('legal/terms.md') ? imported : ['altered'] };
	return outcome;
}

test('a verified export replaces content/export/ completely', () => {
	expect(run(() => undefined)).toEqual({ code: 0, output: '', imported: ['quotes.yaml', 'legal/terms.md', 'company.yaml'] });
});

test('a file changed after the export is refused and nothing is replaced', () => {
	const outcome = run((source) => { appendFileSync(join(source, 'legal/terms.md'), 'Improved.\n'); });
	expect(outcome.code).toBe(1);
	expect(outcome.output).toContain('quote-hash: changed or missing since the export');
	expect(outcome.imported).toEqual(['legal/old.md']);
});

test('a quote that no longer matches its hash is refused', () => {
	const outcome = run((source) => {
		const index = join(source, 'quotes.yaml');
		writeFileSync(index, readFileSync(index, 'utf8').replace("text: '1.1 Synthetic clause.'", "text: '1.1 Better clause.'").replace('text: 1.1 Synthetic clause.', 'text: 1.1 Better clause.'));
	});
	expect(outcome.code).toBe(1);
	expect(outcome.output).toContain('quote "synthetic-clause" changed since the export');
	expect(outcome.imported).toEqual(['legal/old.md']);
});

test('an index outside the schema is refused', () => {
	const outcome = run((source) => { appendFileSync(join(source, 'quotes.yaml'), 'extra: true\n'); });
	expect(outcome.code).toBe(1);
	expect(outcome.output).toContain('import: schema: ');
	expect(outcome.imported).toEqual(['legal/old.md']);
});

test('a listed path outside the export folder is refused', () => {
	const outcome = run((source) => {
		const index = join(source, 'quotes.yaml');
		writeFileSync(index, readFileSync(index, 'utf8').replace('path: company.yaml', 'path: ../company.yaml'));
	});
	expect(outcome.code).toBe(1);
	expect(outcome.output).toContain('"../company.yaml" points outside the export folder');
});

test('a listed file that links outside the export folder is refused', () => {
	const outcome = run((source) => {
		const outside = join(source, '..', 'terms.md');
		renameSync(join(source, 'legal/terms.md'), outside);
		symlinkSync(outside, join(source, 'legal/terms.md'));
	});
	expect(outcome.code).toBe(1);
	expect(outcome.output).toContain('"legal/terms.md" points outside the export folder');
	expect(outcome.imported).toEqual(['legal/old.md']);
});

test('a folder without quotes.yaml or inside the repository is refused', () => {
	expect(run((source) => { writeFileSync(join(source, 'quotes.yaml'), ''); }, (source) => [join(source, 'legal')]).output).toContain('no quotes.yaml: not an export folder');
	const repository = workspace(syntheticExport(legal, quotes));
	expect(importExport([join(repository.directory, 'content/export')], repository.directory)).toBe(1);
	repository.remove();
	expect(printed.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('the export must come from outside this repository');
});

test('the command takes exactly one folder', () => {
	expect(run(() => undefined, () => []).code).toBe(2);
	expect(run(() => undefined, (source) => [source, source]).code).toBe(2);
});
