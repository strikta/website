import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { exportProblems, loadExport } from '../src/quote.ts';
import { exportFindings } from './export.ts';
import { format, type Finding } from './finding.ts';
import { root } from './local.ts';

const INDEX = 'quotes.yaml';
const TARGET = join('content', 'export');
const SECTION = 'Hard boundaries';

if (import.meta.main) {
	process.exitCode = importExport(process.argv.slice(2), root);
}

/** `import-export <dir>`: verifies an export folder and replaces `content/export/` with it, the only writer of that folder. */
export function importExport(argv: readonly string[], directory: string): number {
	const [source] = argv;
	if (source === undefined || argv.length !== 1) {
		process.stderr.write('Usage: npm run import-export -- <export folder>\n');
		return 2;
	}
	const location = resolve(source);
	const checked = sourceFindings(location, directory);
	const findings = checked.length > 0 ? checked : replaceExport(location, join(directory, TARGET));
	process.stderr.write(findings.map((finding) => `${format(finding)}\n`).join(''));
	const code = findings.length > 0 ? 1 : 0;
	if (code === 0) {
		process.stdout.write(`content/export/ now holds export ${loadExport(join(directory, TARGET))?.export_sha256 ?? ''}\n`);
	}
	return code;
}

function sourceFindings(location: string, directory: string): readonly Finding[] {
	const index = join(location, INDEX);
	if (!existsSync(index)) {
		const missing = [importFinding(location, `no ${INDEX}: not an export folder`)];
		return missing;
	}
	if (isWithin(realpathSync(location), realpathSync(directory))) {
		const inside = [importFinding(location, 'the export must come from outside this repository')];
		return inside;
	}
	const problems = exportProblems(readFileSync(index, 'utf8')).map((problem) => importFinding(index, `schema: ${problem}`));
	const findings = problems.length > 0 ? problems : [...pathFindings(location, index), ...exportFindings(location, location)];
	return findings;
}

function pathFindings(location: string, index: string): readonly Finding[] {
	const escaping = (loadExport(location)?.files ?? []).filter((file) => escapes(resolve(location, file.path), location));
	const findings = escaping.map((file) => importFinding(index, `"${file.path}" points outside the export folder`));
	return findings;
}

/** Copies the listed files into a staging folder, checks the copy again, then swaps it in for the old export. */
function replaceExport(location: string, target: string): readonly Finding[] {
	const paths = [INDEX, ...(loadExport(location)?.files ?? []).map((file) => file.path)];
	mkdirSync(dirname(target), { recursive: true });
	const staging = mkdtempSync(join(dirname(target), '.import-'));
	for (const path of paths) {
		mkdirSync(dirname(join(staging, path)), { recursive: true });
		writeFileSync(join(staging, path), readFileSync(join(location, path)));
	}
	const findings = exportFindings(staging, location);
	if (findings.length > 0) {
		rmSync(staging, { recursive: true, force: true });
		return findings;
	}
	rmSync(target, { recursive: true, force: true });
	renameSync(staging, target);
	return findings;
}

/** Whether a listed path leaves the export folder, by its own name or by a symbolic link along the way. */
function escapes(path: string, location: string): boolean {
	const outside = !isWithin(path, location) || path === location || (existsSync(path) && !isWithin(realpathSync(path), realpathSync(location)));
	return outside;
}

function isWithin(path: string, directory: string): boolean {
	const inner = relative(directory, path);
	const within = inner === '' || !(inner === '..' || inner.startsWith(`..${sep}`) || isAbsolute(inner));
	return within;
}

function importFinding(file: string, fix: string): Finding {
	const finding = { file, line: 1, rule: 'import', fix: `${fix}: regenerate the export in the private repository`, section: SECTION };
	return finding;
}
