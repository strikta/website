import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { builtFindings } from './built.ts';
import { contrastFindings, filenameFindings, foundingFindings } from './data.ts';
import { exportFindings } from './export.ts';
import { format, type Finding } from './finding.ts';
import { LOCAL_FILE, localSettings, localWarning, root, type Local } from './local.ts';
import { emailFindings, internalFindings, localFindings, messageFindings } from './text.ts';

type Command = (targets: readonly string[], directory: string) => readonly Finding[];
type Commit = { readonly sha: string; readonly body: string };
type Entry = { readonly sha: string; readonly path: string };
type Push = { readonly tips: readonly string[]; readonly names: readonly string[] };
type Text = { readonly path: string; readonly text: string };
type Settings = { readonly local: Local; readonly findings: readonly Finding[] };

const EXPORT = 'content/export/';
const COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
	['scan', scan],
	['message', message],
	['built', built],
	['pushed', pushed]
]);
const UNSET = /^0+$/u;
const LOG_BUFFER = 256 * 1024 * 1024;
const OBJECT = /^(?<sha>[0-9a-f]+) (?<path>.+)$/u;
const BATCH_HEADER = /^[0-9a-f]+ blob (?<size>\d+)$/u;
const TAG_TARGET = /^object (?<sha>[0-9a-f]+)$/mu;
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
	const { local, findings: refused } = settings(directory, false);
	const paths = files.map((file) => relative(directory, resolve(directory, file)).split(sep).join('/'));
	const texts = paths.filter((path) => existsSync(join(directory, path))).flatMap((path) => textOf(directory, path));
	const names = paths.filter((path) => existsSync(join(directory, path))).flatMap((path) => localFindings(`${path} (file name)`, path, local));
	const fileFindings = texts.flatMap(({ path, text }) => [
		...(path.startsWith('tool/') || path === 'package-lock.json' ? [] : internalFindings(path, text)),
		...(/^tool\/.*\.test\.ts$/u.test(path) ? [] : emailFindings(path, text)),
		...localFindings(path, text, local),
		...(DATA_RULES.get(path)?.(path, text) ?? []),
		...(path.startsWith('src/components/') ? filenameFindings(path) : [])
	]);
	const exported = paths.some((path) => path.startsWith(EXPORT)) ? exportFindings(join(directory, EXPORT), EXPORT) : [];
	const findings = [...refused, ...names, ...fileFindings, ...exported];
	return findings;
}

function message(files: readonly string[], directory: string): readonly Finding[] {
	const { local, findings: refused } = settings(directory, false);
	const findings = [...refused, ...files.flatMap((file) => messageFindings('commit message', readFileSync(resolve(directory, file), 'utf8'), local))];
	return findings;
}

function built(targets: readonly string[], directory: string): readonly Finding[] {
	const [dist = 'dist'] = targets;
	const location = resolve(directory, dist);
	const { local, findings: refused } = settings(directory, false);
	const findings = existsSync(location)
		? [...refused, ...builtFindings(location, directory, local)]
		: [{ file: dist, line: 1, rule: 'built', fix: 'nothing built: run npm run build first', section: 'Commands' }];
	return findings;
}

/** Everything a push publishes (pre-push refs on stdin, or revisions): no host or private term in a ref name, an annotated tag, or any unpushed commit's message, author, committer, file names or file content. */
function pushed(targets: readonly string[], directory: string): readonly Finding[] {
	const { local, findings: refused } = settings(directory, true);
	const { tips, names } = targets.length > 0 ? { tips: targets, names: targets } : pushedRefs(readFileSync(0, 'utf8'));
	const refs = names.flatMap((name) => localFindings('a pushed ref name', name, local));
	const tags = tagTexts(directory, tips).flatMap(({ path, text }) => localFindings(path, text, local));
	const messages = unpushedCommits(directory, tips).flatMap((commit) => localFindings(`commit ${commit.sha}`, commit.body, local));
	const paths = unpushedPaths(directory, tips).flatMap(({ path, text }) => localFindings(path, text, local));
	const contents = unpushedTexts(directory, tips).flatMap(({ path, text }) => localFindings(`${path} (in a pushed commit)`, text, local));
	const findings = [...refused, ...refs, ...tags, ...messages, ...paths, ...contents];
	return findings;
}

/** The local guard file; prints why the private-term rule is off, and refuses a file that cannot be read, or a missing one when it is required. */
function settings(directory: string, required: boolean): Settings {
	const local = localSettings(directory);
	const warning = localWarning(local);
	const missing = required && !local.present ? ['missing: create it with your private_terms list before pushing'] : [];
	const problems = [...missing, ...(local.problem === undefined ? [] : [`${local.problem}: fix it by hand`])];
	if (warning !== undefined && problems.length === 0) {
		process.stderr.write(`warning: ${warning}\n`);
	}
	const findings = problems.map((fix) => ({ file: LOCAL_FILE, line: 1, rule: 'local-file', fix, section: 'Hard boundaries' }));
	return { local, findings };
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

/** The annotated tag objects among the tips, and the tags they point to, each as its full text: tagger and message. */
function tagTexts(directory: string, tips: readonly string[]): readonly Text[] {
	const texts = tips.flatMap((tip) => {
		const kind = execFileSync('git', ['cat-file', '-t', tip], { cwd: directory, encoding: 'utf8' }).trim();
		const text = kind === 'tag' ? execFileSync('git', ['cat-file', 'tag', tip], { cwd: directory, encoding: 'utf8' }) : undefined;
		const target = text === undefined ? undefined : TAG_TARGET.exec(text)?.groups?.['sha'];
		return text === undefined ? [] : [{ path: `tag ${tip}`, text }, ...tagTexts(directory, target === undefined ? [] : [target])];
	});
	return texts;
}

function unpushedCommits(directory: string, tips: readonly string[]): readonly Commit[] {
	const log = tips.length === 0 ? '' : execFileSync('git', ['log', '--format=%H%x1f%B%n%an <%ae>%n%cn <%ce>%x00', ...tips, '--not', '--remotes'], { cwd: directory, encoding: 'utf8', maxBuffer: LOG_BUFFER });
	const commits = log
		.split('\0')
		.map((entry) => entry.trim().split('\u001f'))
		.flatMap(([sha, body]) => (sha === undefined || body === undefined ? [] : [{ sha, body }]));
	return commits;
}

/** The file names each unpushed commit adds or changes, merges against each parent and a rename as its new name; a removed name was added by an earlier commit. */
function unpushedPaths(directory: string, tips: readonly string[]): readonly Text[] {
	const log = tips.length === 0 ? '' : execFileSync('git', ['log', '-z', '-m', '--no-renames', '--diff-filter=d', '--name-only', '--format=%x1e%H', ...tips, '--not', '--remotes'], { cwd: directory, encoding: 'utf8', maxBuffer: LOG_BUFFER });
	const paths = log.split(RECORD).flatMap((record) => {
		const [sha = '', ...names] = record.split('\0').map((name) => name.replace(/^\n/u, ''));
		return names.filter((name) => name !== '').map((name) => ({ path: `commit ${sha} (file name)`, text: name }));
	});
	return paths;
}

/** Every text file reachable from the tips that no remote holds yet: what a push uploads, whatever the working tree now shows. */
function unpushedTexts(directory: string, tips: readonly string[]): readonly Text[] {
	const listing = tips.length === 0 ? '' : execFileSync('git', ['rev-list', '--objects', '--filter=object:type=blob', ...tips, '--not', '--remotes'], { cwd: directory, encoding: 'utf8', maxBuffer: LOG_BUFFER });
	const blobs = listing.split('\n').flatMap((line) => {
		const groups = OBJECT.exec(line)?.groups;
		return groups?.['sha'] === undefined || groups['path'] === undefined ? [] : [{ sha: groups['sha'], path: groups['path'] }];
	});
	const texts = blobs.length === 0 ? [] : blobTexts(directory, blobs);
	return texts;
}

/** Reads the blobs through one `git cat-file --batch`, skipping binary content. */
function blobTexts(directory: string, blobs: readonly Entry[]): readonly Text[] {
	const output = execFileSync('git', ['cat-file', '--batch'], { cwd: directory, input: blobs.map((blob) => `${blob.sha}\n`).join(''), maxBuffer: LOG_BUFFER });
	const texts: Text[] = [];
	let offset = 0;
	for (const blob of blobs) {
		const end = output.indexOf(0x0a, offset);
		const size = BATCH_HEADER.exec(output.toString('utf8', offset, end))?.groups?.['size'];
		const content = size === undefined ? undefined : output.subarray(end + 1, end + 1 + Number(size));
		offset = content === undefined ? end + 1 : end + 2 + content.length;
		texts.push(...(content === undefined || content.includes(0) ? [] : [{ path: blob.path, text: content.toString('utf8') }]));
	}
	return texts;
}

function textOf(directory: string, path: string): readonly Text[] {
	const content = readFileSync(join(directory, path));
	const texts = content.includes(0) ? [] : [{ path, text: content.toString('utf8') }];
	return texts;
}
