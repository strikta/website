import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadExport, type Export } from '../src/quote.ts';
import type { Finding } from './finding.ts';

const INDEX = 'quotes.yaml';

/** `content/export/`: every exported file and quote still has the hash the private export recorded. */
export function exportFindings(directory: string, label: string): readonly Finding[] {
	const exported = loadExport(directory);
	const findings =
		exported === undefined
			? []
			: [...fileFindings(directory, label, exported), ...quoteFindings(label, exported), ...sourceFindings(directory, label, exported), ...unlistedFindings(directory, label, exported)];
	return findings;
}

/** SHA-256 over the sorted `<hash>  <path>` lines of the exported files. */
export function exportDigest(files: Export['files']): string {
	const lines = files.map((file) => `${file.sha256}  ${file.path}\n`).sort();
	const digest = sha256(lines.join(''));
	return digest;
}

export function sha256(content: string | Buffer): string {
	const digest = createHash('sha256').update(content).digest('hex');
	return digest;
}

function fileFindings(directory: string, label: string, exported: Export): readonly Finding[] {
	const changed = exported.files.filter((file) => {
		const path = join(directory, file.path);
		const intact = existsSync(path) && sha256(readFileSync(path)) === file.sha256;
		return !intact;
	});
	const findings = changed.map((file) => hashFinding(join(label, file.path), 'changed or missing since the export'));
	return findings;
}

function quoteFindings(label: string, exported: Export): readonly Finding[] {
	const changed = exported.quotes.filter((quote) => sha256(quote.text) !== quote.sha256);
	const digest = exportDigest(exported.files) === exported.export_sha256 ? [] : [hashFinding(join(label, INDEX), 'export_sha256 does not match the file list')];
	const findings = [...changed.map((quote) => hashFinding(join(label, INDEX), `quote "${quote.id}" changed since the export`)), ...digest];
	return findings;
}

function sourceFindings(directory: string, label: string, exported: Export): readonly Finding[] {
	const listed = new Set(exported.files.map((file) => file.path));
	const misplaced = exported.quotes.filter((quote) => {
		const file = 'file' in quote.source ? quote.source.file : undefined;
		const path = file === undefined ? '' : join(directory, file);
		const verbatim = file === undefined || (listed.has(file) && existsSync(path) && readFileSync(path, 'utf8').includes(quote.text));
		return !verbatim;
	});
	const findings = misplaced.map((quote) => hashFinding(join(label, INDEX), `quote "${quote.id}" is not verbatim in its source file`));
	return findings;
}

function unlistedFindings(directory: string, label: string, exported: Export): readonly Finding[] {
	const listed = new Set([INDEX, ...exported.files.map((file) => file.path)]);
	const present = readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() || entry.isSymbolicLink())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)));
	const findings = present.filter((path) => !listed.has(path)).map((path) => hashFinding(join(label, path), 'not listed in the export'));
	return findings;
}

function hashFinding(file: string, problem: string): Finding {
	const finding = { file, line: 1, rule: 'quote-hash', fix: `${problem}: regenerate the export in the private repository`, section: 'Hard boundaries' };
	return finding;
}
