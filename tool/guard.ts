import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import * as zod from 'zod';
import { localHosts, root } from './local.ts';

export type Call = { readonly tool_name: string; readonly tool_input: Readonly<Record<string, unknown>> };
export type Context = {
	readonly root: string;
	readonly allowed: readonly string[];
	readonly hosts: readonly string[];
	readonly deploying: boolean;
	readonly home: string;
};
type Rule = { readonly pattern: RegExp; readonly reason: string };

const ARGUMENTS = String.raw`[^&|;\n]*\s`;
const FLAG_END = String.raw`(?=\s|$)`;
const COMMAND_RULES: readonly Rule[] = [
	{ pattern: /\bgit\s+stash\b/u, reason: 'git stash is shared by every worktree' },
	{ pattern: new RegExp(String.raw`\bgit\s+add\b${ARGUMENTS}(?:-[a-zA-Z]*[Au][a-zA-Z]*|--all|--update|\.|:/)${FLAG_END}`, 'u'), reason: 'add named files only' },
	{ pattern: new RegExp(String.raw`\bgit\s+commit\b${ARGUMENTS}(?:-[a-zA-Z]*a[a-zA-Z]*|--all)${FLAG_END}`, 'u'), reason: 'add named files only' },
	{ pattern: new RegExp(String.raw`\bgit\s+(?:reset\b${ARGUMENTS}--hard${FLAG_END}|clean\b|checkout\b${ARGUMENTS}(?:--|\.|--force|-[a-zA-Z]*f[a-zA-Z]*)${FLAG_END}|switch\b${ARGUMENTS}(?:--discard-changes|--force|-[a-zA-Z]*f[a-zA-Z]*)${FLAG_END})`, 'u'), reason: 'destructive git' },
	{ pattern: new RegExp(String.raw`\bgit\s+restore\b(?:(?!${ARGUMENTS}(?:--staged|-[a-zA-Z]*S[a-zA-Z]*)${FLAG_END})|(?=${ARGUMENTS}(?:--worktree|-[a-zA-Z]*W[a-zA-Z]*)${FLAG_END}))`, 'u'), reason: 'destructive git' },
	{ pattern: new RegExp(String.raw`\bgit\s+push\b${ARGUMENTS}(?:--force|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)${FLAG_END}`, 'u'), reason: 'force push: use --force-with-lease on your own branch' },
	{ pattern: new RegExp(String.raw`--no-verify\b|\bgit\s+commit\b${ARGUMENTS}-[a-zA-Z]*n[a-zA-Z]*${FLAG_END}|\bLEFTHOOK\w*=|core\.hooksPath`, 'u'), reason: 'hooks are not optional' },
	{ pattern: /\b(?:pkill|killall)\b/u, reason: 'kill by process ID only' },
	{ pattern: /\bprettier\b/u, reason: 'no whole-tree formatters' },
	{ pattern: /\b(?:hcloud|gandi|doctl|gh\s+repo\s+(?:create|edit|delete|rename|archive)|gh\s+(?:secret|variable|ruleset)|gh\s+api\s+[^&|;\n]*-X\s*(?:DELETE|PATCH|PUT))\b/u, reason: 'infrastructure needs the founder' },
	{ pattern: /\.guard\.local\.yaml/u, reason: 'the local guard file stays on the founder\'s machine' },
	{ pattern: /;/u, reason: 'no ; chains: use && so a failure stops the chain' }
];
const GIT_GLOBAL = /\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:git-dir|work-tree|namespace|config-env|super-prefix)(?:=|\s+)\S+|--exec-path(?:=\S+)?|--(?:no-pager|paginate|bare|no-replace-objects|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-optional-locks|no-advice|no-lazy-fetch)|-[pP]))+(?=\s|$)/gu;
const REMOTE = /\b(?:ssh|scp|rsync|sftp)\b/u;
const SHELL_TOKEN = /(?<=^|[\s"'=:<>])[^\s"'`;|&<>()=:]+/gu;
const PATH_LIKE = /^(?:~|\.\.|\/(?!\/))|(?:^|\/)\.\.(?:\/|$)/u;
const NAMED_HOME = /^~[^/]/u;
const PATCH_HEADER = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (?<path>.+)$/gmu;
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'];
const EDITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);
const GENERATED = `content${sep}export${sep}`.toLowerCase();
const PRIVATE_FILE = '.guard.local.yaml';

const callSchema = zod.object({ tool_name: zod.string(), tool_input: zod.record(zod.string(), zod.unknown()) });

if (import.meta.main) {
	guard();
}

function guard(): void {
	const call = callSchema.parse(JSON.parse(readFileSync(0, 'utf8')));
	const findings = inspect(call, localContext());
	if (findings.length > 0) {
		process.stderr.write(`Blocked by the website guard: ${findings.join('; ')}. See AGENTS.md, "Hard boundaries".\n`);
		process.exit(2);
	}
}

/** Every reason the call breaks a boundary; empty when it may run. */
export function inspect(call: Call, context: Context): readonly string[] {
	const findings = [...commandFindings(call, context), ...pathFindings(call, context), ...hostFindings(call, context)];
	const unique = [...new Set(findings)];
	return unique;
}

function localContext(): Context {
	const temporary = [tmpdir(), '/tmp'].filter((path) => existsSync(path)).map((path) => realpathSync.native(path));
	const context = {
		root: realpathSync.native(root),
		allowed: [...temporary, '/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr'],
		hosts: localHosts(root),
		deploying: process.env['STRIKTA_SITE_DEPLOY'] === '1',
		home: homedir()
	};
	return context;
}

function commandFindings(call: Call, context: Context): readonly string[] {
	const command = shellCommand(call);
	const normalised = command.replace(GIT_GLOBAL, 'git');
	const ruled = COMMAND_RULES.filter((rule) => rule.pattern.test(command) || rule.pattern.test(normalised)).map((rule) => rule.reason);
	const remote = REMOTE.test(command) && !context.deploying ? ['remote access needs the founder\'s "deploy"'] : [];
	const findings = [...ruled, ...remote];
	return findings;
}

function pathFindings(call: Call, context: Context): readonly string[] {
	const candidates = candidatePaths(call, context);
	const named = candidates.filter((path) => NAMED_HOME.test(path)).map((path) => `a ~name path cannot be resolved: ${path}`);
	const located = candidates.filter((path) => !NAMED_HOME.test(path)).map((path) => locate(path, context));
	const outside = located.filter((path) => !isInside(path, context)).map((path) => `path outside this repository: ${path}`);
	const inner = located.map((path) => relative(context.root, path).toLowerCase());
	const local = inner.filter((path) => path === PRIVATE_FILE).map(() => 'the local guard file stays on the founder\'s machine');
	const generated = EDITING.has(call.tool_name) ? inner.filter((path) => `${path}${sep}`.startsWith(GENERATED)) : [];
	const findings = [...named, ...outside, ...local, ...generated.map(() => 'content/export is generated: a new export is the only fix')];
	return findings;
}

function candidatePaths(call: Call, context: Context): readonly string[] {
	const fields = PATH_FIELDS.map((key) => call.tool_input[key]).filter((value) => typeof value === 'string');
	const { pattern, glob } = call.tool_input;
	const globs = [call.tool_name === 'Glob' ? pattern : undefined, call.tool_name === 'Grep' ? glob : undefined].filter((value): value is string => typeof value === 'string' && PATH_LIKE.test(value));
	const shell = call.tool_name === 'apply_patch' ? [] : (shellCommand(call).match(SHELL_TOKEN) ?? []).filter((token) => PATH_LIKE.test(token));
	const patched = [...patchText(call).matchAll(PATCH_HEADER)].map((match) => match.groups?.['path'] ?? '');
	const paths = [...fields, ...globs, ...shell, ...patched].map((path) => path.replace(/^~(?=\/|$)/u, context.home));
	return paths;
}

function shellCommand(call: Call): string {
	const { command } = call.tool_input;
	const text = typeof command === 'string' ? command : '';
	return text;
}

function patchText(call: Call): string {
	const strings = Object.values(call.tool_input).filter((value) => typeof value === 'string');
	const text = call.tool_name === 'apply_patch' ? strings.join('\n') : '';
	return text;
}

function locate(path: string, context: Context): string {
	const absolute = isAbsolute(path) ? resolve(path) : resolve(context.root, path);
	const existing = nearestExisting(absolute);
	const located = resolve(realpathSync.native(existing), relative(existing, absolute));
	return located;
}

function nearestExisting(path: string): string {
	const existing = existsSync(path) || dirname(path) === path ? path : nearestExisting(dirname(path));
	return existing;
}

function isInside(path: string, context: Context): boolean {
	const prefixes = [context.root, ...context.allowed];
	const inside = prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}${sep}`));
	return inside;
}

function hostFindings(call: Call, context: Context): readonly string[] {
	const text = JSON.stringify(call.tool_input).toLowerCase();
	const named = context.hosts.some((host) => text.includes(host.toLowerCase()));
	const findings = named ? ['names a production host'] : [];
	return findings;
}
