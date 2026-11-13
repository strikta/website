import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { builtFindings } from './built.ts';
import { contrastFindings, filenameFindings, foundingFindings } from './data.ts';
import { exportFindings } from './export.ts';
import { format, type Finding } from './finding.ts';
import { localHosts, root } from './local.ts';
import { emailFindings, hostFindings, internalFindings, messageFindings } from './text.ts';

type Command = (targets: readonly string[], directory: string) => readonly Finding[];
type Text = { readonly path: string; readonly text: string };
type Change = { readonly commit: string; readonly mode: string; readonly sha: string; readonly path: string };
type Push = { readonly tips: readonly string[]; readonly names: readonly string[] };

const EXPORT = 'content/export/';
const COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
	['scan', scan],
	['message', message],
	['built', built],
	['pushed', pushed]
]);
const UNSET = /^0+$/u;
const GIT_BUFFER = 256 * 1024 * 1024;
const COMMIT = /^(?<commit>[0-9a-f]+)\0/u;
const CHANGE = /:\d{6} (?<mode>\d{6}) [0-9a-f]+ (?<sha>[0-9a-f]+) [A-Z]+\0(?<path>[^\0]+)\0/gu;
const GITLINK = '160000';
const BATCH_HEADER = /^[0-9a-f]+ blob (?<size>\d+)$/u;
const RECORD = '\u001e';
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
	const hosts = localHosts(directory);
	const paths = files.map((file) => relative(directory, resolve(directory, file)).split(sep).join('/'));
	const texts = paths.filter((path) => existsSync(join(directory, path))).flatMap((path) => textOf(directory, path));
	const fileFindings = texts.flatMap(({ path, text }) => [
		...boundaryFindings(path, path, text, hosts),
		...(DATA_RULES.get(path)?.(path, text) ?? []),
		...(path.startsWith('src/components/') ? filenameFindings(path) : [])
	]);
	const exported = paths.some((path) => path.startsWith(EXPORT)) ? exportFindings(join(directory, EXPORT), EXPORT) : [];
	const findings = [...fileFindings, ...exported];
	return findings;
}

function message(files: readonly string[], directory: string): readonly Finding[] {
	const hosts = localHosts(directory);
	const findings = files.flatMap((file) => messageFindings('commit message', readFileSync(resolve(directory, file), 'utf8'), hosts));
	return findings;
}

function built(targets: readonly string[], directory: string): readonly Finding[] {
	const [dist = 'dist'] = targets;
	const location = resolve(directory, dist);
	const findings = existsSync(location)
		? builtFindings(location, directory, localHosts(directory))
		: [{ file: dist, line: 1, rule: 'built', fix: 'nothing built: run npm run build first', section: 'Commands' }];
	return findings;
}

/** Everything a push publishes (pre-push refs on stdin, or revisions): no internal identifier or host in a ref name, or in any unpushed commit's message, file names or file content. */
function pushed(targets: readonly string[], directory: string): readonly Finding[] {
	const push = targets.length > 0 ? { tips: targets, names: targets } : pushedRefs(readFileSync(0, 'utf8'));
	const findings = pushFindings(push, directory);
	return findings;
}

function pushFindings({ tips, names }: Push, directory: string): readonly Finding[] {
	const hosts = localHosts(directory);
	const changes = unpushedChanges(directory, tips);
	const refs = names.flatMap((name) => [...internalFindings('a pushed ref name', name), ...hostFindings('a pushed ref name', name, hosts)]);
	const messages = unpushedMessages(directory, tips).flatMap(({ path, text }) => messageFindings(path, text, hosts));
	const paths = changes.flatMap(({ commit, path }) => [...internalFindings(`commit ${commit} (file name)`, path), ...hostFindings(`commit ${commit} (file name)`, path, hosts)]);
	const contents = changedTexts(directory, changes).flatMap(({ path, text }) => boundaryFindings(path, `${path} (in a pushed commit)`, text, hosts));
	const findings = [...refs, ...messages, ...paths, ...contents];
	return findings;
}

/** The rules every public text obeys wherever it sits: no internal identifier outside the checker, no real email address outside its tests, no host. */
function boundaryFindings(path: string, file: string, text: string, hosts: readonly string[]): readonly Finding[] {
	const findings = [
		...(path.startsWith('tool/') || path === 'package-lock.json' ? [] : internalFindings(file, text)),
		...(/^tool\/.*\.test\.ts$/u.test(path) ? [] : emailFindings(file, text)),
		...hostFindings(file, text, hosts)
	];
	return findings;
}

/** The local tips and the local and remote ref names from the pre-push input. */
function pushedRefs(input: string): Push {
	const lines = input
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.map((line) => line.split(/\s+/u));
	const tips = lines.flatMap(([, sha]) => (sha === undefined || UNSET.test(sha) ? [] : [sha]));
	const names = lines.flatMap(([localRef, , remoteRef]) => [localRef, remoteRef].flatMap((name) => (name === undefined ? [] : [name])));
	return { tips, names };
}

/** The message of each commit reachable from the tips that no remote holds yet. */
function unpushedMessages(directory: string, tips: readonly string[]): readonly Text[] {
	const log = tips.length === 0 ? '' : execFileSync('git', ['log', '--format=%H%x1f%B%x00', ...tips, '--not', '--remotes'], { cwd: directory, encoding: 'utf8', maxBuffer: GIT_BUFFER });
	const messages = log
		.split('\0')
		.map((entry) => entry.replace(/^\n/u, '').split('\u001f'))
		.flatMap(([sha, body]) => (sha === undefined || body === undefined ? [] : [{ path: `commit ${sha}`, text: body }]));
	return messages;
}

/** Each file an unpushed commit adds or changes, with the blob it holds there: merges against each parent, a rename as its new name. */
function unpushedChanges(directory: string, tips: readonly string[]): readonly Change[] {
	const log = tips.length === 0 ? '' : execFileSync('git', ['log', '-z', '-m', '--root', '--raw', '--no-abbrev', '--no-renames', '--diff-filter=d', '--format=%x1e%H', ...tips, '--not', '--remotes'], { cwd: directory, encoding: 'utf8', maxBuffer: GIT_BUFFER });
	const changes = log.split(RECORD).flatMap((record) => {
		const commit = COMMIT.exec(record)?.groups?.['commit'] ?? '';
		return [...record.matchAll(CHANGE)].flatMap(({ groups }) => (groups?.['sha'] === undefined || groups['path'] === undefined ? [] : [{ commit, mode: groups['mode'] ?? '', sha: groups['sha'], path: groups['path'] }]));
	});
	return changes;
}

/** The text of every changed blob under every path it was committed at, so an exempt path never hides the same content elsewhere. */
function changedTexts(directory: string, changes: readonly Change[]): readonly Text[] {
	const placed = new Map(changes.filter(({ mode }) => mode !== GITLINK).map(({ sha, path }) => [`${sha} ${path}`, { sha, path }] as const));
	const shas = [...new Set([...placed.values()].map(({ sha }) => sha))];
	const contents = shas.length === 0 ? new Map<string, string>() : blobTexts(directory, shas);
	const texts = [...placed.values()].flatMap(({ sha, path }) => {
		const text = contents.get(sha);
		return text === undefined ? [] : [{ path, text }];
	});
	return texts;
}

/** Reads the blobs through one `git cat-file --batch`, skipping binary content. */
function blobTexts(directory: string, shas: readonly string[]): ReadonlyMap<string, string> {
	const output = execFileSync('git', ['cat-file', '--batch'], { cwd: directory, input: shas.map((sha) => `${sha}\n`).join(''), maxBuffer: GIT_BUFFER });
	const texts = new Map<string, string>();
	let offset = 0;
	for (const sha of shas) {
		const end = output.indexOf(0x0a, offset);
		const size = BATCH_HEADER.exec(output.toString('utf8', offset, end))?.groups?.['size'];
		const content = size === undefined ? undefined : output.subarray(end + 1, end + 1 + Number(size));
		offset = content === undefined ? end + 1 : end + 2 + content.length;
		if (content !== undefined && !content.includes(0)) {
			texts.set(sha, content.toString('utf8'));
		}
	}
	return texts;
}

function textOf(directory: string, path: string): readonly Text[] {
	const content = readFileSync(join(directory, path));
	const texts = content.includes(0) ? [] : [{ path, text: content.toString('utf8') }];
	return texts;
}
