import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import * as zod from 'zod';
import { localHosts, root } from './local.ts';
import { separated } from './shell.ts';

export type Call = { readonly tool_name: string; readonly tool_input: Readonly<Record<string, unknown>> };
export type Context = {
	readonly root: string;
	readonly allowed: readonly string[];
	readonly hosts: readonly string[];
	readonly deploying: boolean;
	readonly home: string;
};
type Rule = { readonly pattern: RegExp; readonly reason: string };

const TOKENS = String.raw`(?:[^\s&|;]+\s+)*?`;
const COMMAND_RULES: readonly Rule[] = [
	{ pattern: /\bgit\s+stash\b/u, reason: 'git stash is shared by every worktree' },
	{ pattern: new RegExp(String.raw`\bgit\s+add\s+${TOKENS}(?:-A|--all|-u|--update|\.)(?=\s|$)`, 'u'), reason: 'add named files only' },
	{ pattern: new RegExp(String.raw`\bgit\s+commit\s+${TOKENS}(?:-[a-zA-Z]*a[a-zA-Z]*|--all)(?=\s|$)`, 'u'), reason: 'add named files only' },
	{ pattern: /\bgit\s+(?:reset\s+--hard|clean\b|checkout\s+--(?=\s|$)|restore\b(?![^&|;\n]*--staged))/u, reason: 'destructive git' },
	{ pattern: /\bgit\s+push\b[^&|;\n]*(?:\s--force(?![-\w])|\s-[a-zA-Z]*f\b|\s\+\S)/u, reason: 'force push: use --force-with-lease on your own branch' },
	{ pattern: new RegExp(String.raw`--no-verify\b|\bgit\s+commit\s+${TOKENS}-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)|\bLEFTHOOK\w*=|core\.hooksPath`, 'u'), reason: 'hooks are not optional' },
	{ pattern: /\b(?:pkill|killall)\b/u, reason: 'kill by process ID only' },
	{ pattern: /\bprettier\b/u, reason: 'no whole-tree formatters' },
	{ pattern: /\b(?:hcloud|gandi|doctl|gh\s+repo\s+(?:create|edit|delete|rename|archive)|gh\s+(?:secret|variable|ruleset)|gh\s+api\s+[^&|;\n]*-X\s*(?:DELETE|PATCH|PUT))\b/u, reason: 'infrastructure needs the founder' },
	{ pattern: /\.guard\.local\.yaml/u, reason: 'the local guard file stays on the founder\'s machine' }
];
const REMOTE = /\b(?:ssh|scp|rsync|sftp)\b/u;
const SHELL_PATH = /(?<=^|[\s"'=:<>])(?!\/\/)(?:~|\.\.|\/)[^\s"'`;|&<>()]*/gu;
const PATCH_HEADER = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (?<path>.+)$/gmu;
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'];
const EDITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);
const GENERATED = `content${sep}export${sep}`;
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
	const temporary = [tmpdir(), '/tmp'].filter((path) => existsSync(path)).map((path) => realpathSync(path));
	const context = {
		root: realpathSync(root),
		allowed: [...temporary, '/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr'],
		hosts: localHosts(root),
		deploying: process.env['STRIKTA_SITE_DEPLOY'] === '1',
		home: homedir()
	};
	return context;
}

function commandFindings(call: Call, context: Context): readonly string[] {
	const command = shellCommand(call);
	const ruled = COMMAND_RULES.filter((rule) => rule.pattern.test(command)).map((rule) => rule.reason);
	const chained = separated(command) ? ['no ; chains: use && so a failure stops the chain'] : [];
	const remote = REMOTE.test(command) && !context.deploying ? ['remote access needs the founder\'s "deploy"'] : [];
	const findings = [...ruled, ...chained, ...remote];
	return findings;
}

function pathFindings(call: Call, context: Context): readonly string[] {
	const located = candidatePaths(call, context).map((path) => locate(path, context));
	const outside = located.filter((path) => !isInside(path, context)).map((path) => `path outside this repository: ${path}`);
	const local = located.filter((path) => relative(context.root, path) === PRIVATE_FILE).map(() => 'the local guard file stays on the founder\'s machine');
	const editing = EDITING.has(call.tool_name);
	const generated = editing ? located.filter((path) => `${relative(context.root, path)}${sep}`.startsWith(GENERATED)) : [];
	const findings = [...outside, ...local, ...generated.map(() => 'content/export is generated: a new export is the only fix')];
	return findings;
}

function candidatePaths(call: Call, context: Context): readonly string[] {
	const fields = PATH_FIELDS.map((key) => call.tool_input[key]).filter((value) => typeof value === 'string');
	const { pattern } = call.tool_input;
	const glob = call.tool_name === 'Glob' && typeof pattern === 'string' && /^(?:~|\.\.|\/)/u.test(pattern) ? [pattern] : [];
	const shell = call.tool_name === 'apply_patch' ? [] : (shellCommand(call).match(SHELL_PATH) ?? []);
	const patched = [...patchText(call).matchAll(PATCH_HEADER)].map((match) => match.groups?.['path'] ?? '');
	const paths = [...fields, ...glob, ...shell, ...patched].map((path) => path.replace(/^~(?=\/|$)/u, context.home));
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
	const located = resolve(realpathSync(existing), relative(existing, absolute));
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
