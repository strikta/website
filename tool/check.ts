import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { builtFindings } from './built.ts';
import { contrastFindings, filenameFindings, foundingFindings } from './data.ts';
import { exportFindings } from './export.ts';
import { format, type Finding } from './finding.ts';
import { localHosts, root } from './local.ts';
import { emailFindings, hostFindings, internalFindings, messageFindings } from './text.ts';

type Command = (targets: readonly string[], directory: string) => readonly Finding[];

const EXPORT = 'content/export/';
const COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
	['scan', scan],
	['message', message],
	['built', built]
]);
const DATA_RULES: ReadonlyMap<string, (file: string, text: string) => readonly Finding[]> = new Map([
	['data/offer.yaml', foundingFindings],
	['data/tokens.yaml', contrastFindings]
]);

if (import.meta.main) {
	process.exitCode = check(process.argv.slice(2), root);
}

/** Runs `scan <files…>`, `message <file>` or `built <dir>`; prints each finding and returns the exit code. */
export function check(argv: readonly string[], directory: string): number {
	const [name = '', ...targets] = argv;
	const command = COMMANDS.get(name);
	if (command === undefined) {
		process.stderr.write('Usage: node tool/check.ts scan <files…> | message <file> | built <dir>\n');
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
		...(path.startsWith('tool/') || path === 'package-lock.json' ? [] : internalFindings(path, text)),
		...(/^tool\/.*\.test\.ts$/u.test(path) ? [] : emailFindings(path, text)),
		...hostFindings(path, text, hosts),
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

function textOf(directory: string, path: string): readonly { path: string; text: string }[] {
	const content = readFileSync(join(directory, path));
	const texts = content.includes(0) ? [] : [{ path, text: content.toString('utf8') }];
	return texts;
}
