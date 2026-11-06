import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { builtFindings } from './built.ts';
import { contrastFindings, filenameFindings, foundingFindings } from './data.ts';
import { exportFindings } from './export.ts';
import { format, type Finding } from './finding.ts';
import { localSettings, root } from './local.ts';
import { emailFindings, internalFindings, localFindings, messageFindings } from './text.ts';

type Command = (targets: readonly string[], directory: string) => readonly Finding[];
type Commit = { readonly sha: string; readonly body: string };

const EXPORT = 'content/export/';
const COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
	['scan', scan],
	['message', message],
	['built', built],
	['pushed', pushed]
]);
const UNSET = /^0+$/u;
const LOG_BUFFER = 256 * 1024 * 1024;
const MISSING_LOCAL = 'warning: .guard.local.yaml is missing: the private-term rule is off\n';
const DATA_RULES: ReadonlyMap<string, (file: string, text: string) => readonly Finding[]> = new Map([
	['data/offer.yaml', foundingFindings],
	['data/tokens.yaml', contrastFindings]
]);

if (import.meta.main) {
	process.exitCode = check(process.argv.slice(2), root);
}

/** Runs `scan <files…>`, `message <file>`, `built <dir>` or `pushed [revisions…]`; prints each finding and returns the exit code. */
export function check(argv: readonly string[], directory: string): number {
	const [name = '', ...targets] = argv;
	const command = COMMANDS.get(name);
	if (command === undefined) {
		process.stderr.write('Usage: node tool/check.ts scan <files…> | message <file> | built <dir> | pushed [revisions…]\n');
		return 2;
	}
	const findings = command(targets, directory);
	process.stderr.write(findings.map((finding) => `${format(finding)}\n`).join(''));
	const code = findings.length > 0 ? 1 : 0;
	return code;
}

function scan(files: readonly string[], directory: string): readonly Finding[] {
	const local = localSettings(directory);
	if (!local.present) {
		process.stderr.write(MISSING_LOCAL);
	}
	const paths = files.map((file) => relative(directory, resolve(directory, file)).split(sep).join('/'));
	const texts = paths.filter((path) => existsSync(join(directory, path))).flatMap((path) => textOf(directory, path));
	const fileFindings = texts.flatMap(({ path, text }) => [
		...(path.startsWith('tool/') || path === 'package-lock.json' ? [] : internalFindings(path, text)),
		...(/^tool\/.*\.test\.ts$/u.test(path) ? [] : emailFindings(path, text)),
		...localFindings(path, text, local),
		...(DATA_RULES.get(path)?.(path, text) ?? []),
		...(path.startsWith('src/components/') ? filenameFindings(path) : [])
	]);
	const exported = paths.some((path) => path.startsWith(EXPORT)) ? exportFindings(join(directory, EXPORT), EXPORT) : [];
	const findings = [...fileFindings, ...exported];
	return findings;
}

function message(files: readonly string[], directory: string): readonly Finding[] {
	const local = localSettings(directory);
	const findings = files.flatMap((file) => messageFindings('commit message', readFileSync(resolve(directory, file), 'utf8'), local));
	return findings;
}

function built(targets: readonly string[], directory: string): readonly Finding[] {
	const [dist = 'dist'] = targets;
	const location = resolve(directory, dist);
	const findings = existsSync(location)
		? builtFindings(location, directory, localSettings(directory))
		: [{ file: dist, line: 1, rule: 'built', fix: 'nothing built: run npm run build first', section: 'Commands' }];
	return findings;
}

/** Every commit about to be pushed, merges included (pre-push refs on stdin, or revisions): no host or private term in its message. */
function pushed(targets: readonly string[], directory: string): readonly Finding[] {
	const local = localSettings(directory);
	const tips = targets.length > 0 ? targets : pushedTips(readFileSync(0, 'utf8'));
	const findings = unpushedCommits(directory, tips).flatMap((commit) => localFindings(`commit ${commit.sha}`, commit.body, local));
	return findings;
}

function pushedTips(refs: string): readonly string[] {
	const tips = refs
		.split('\n')
		.map((line) => line.trim().split(/\s+/u))
		.flatMap(([, sha]) => (sha === undefined || UNSET.test(sha) ? [] : [sha]));
	return tips;
}

function unpushedCommits(directory: string, tips: readonly string[]): readonly Commit[] {
	const log = tips.length === 0 ? '' : execFileSync('git', ['log', '--format=%H%x1f%B%x00', ...tips, '--not', '--remotes'], { cwd: directory, encoding: 'utf8', maxBuffer: LOG_BUFFER });
	const commits = log
		.split('\0')
		.map((entry) => entry.trim().split('\u001f'))
		.flatMap(([sha, body]) => (sha === undefined || body === undefined ? [] : [{ sha, body }]));
	return commits;
}

function textOf(directory: string, path: string): readonly { path: string; text: string }[] {
	const content = readFileSync(join(directory, path));
	const texts = content.includes(0) ? [] : [{ path, text: content.toString('utf8') }];
	return texts;
}
