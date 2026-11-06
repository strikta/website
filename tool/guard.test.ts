import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import * as zod from 'zod';
import { inspect, verdict, type Call, type Context } from './guard.ts';
import { root } from './local.ts';

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'guard-')));
const repository = join(workspace, 'repository');
const sibling = join(workspace, 'sibling');
mkdirSync(join(repository, 'content', 'export'), { recursive: true });
mkdirSync(sibling);
writeFileSync(join(sibling, 'note.md'), 'synthetic');
symlinkSync(sibling, join(repository, 'linked'));

const hookSchema = zod.object({ hooks: zod.object({ PreToolUse: zod.array(zod.object({ hooks: zod.array(zod.object({ command: zod.string() })) })) }) });
const context: Context = { root: repository, allowed: ['/dev/null'], hosts: ['vm.example.test'], terms: ['Exempelgatan 1', '000000-0000'], deploying: false, home: sibling };

afterAll(() => {
	rmSync(workspace, { recursive: true, force: true });
});

function bash(command: string): Call {
	const call = { tool_name: 'Bash', tool_input: { command } };
	return call;
}

test.each([
	['git stash push -m synthetic', 'git stash is shared by every worktree'],
	['git add .', 'add named files only'],
	['git add -A', 'add named files only'],
	['git add tool/guard.ts --all', 'add named files only'],
	['git add -u', 'add named files only'],
	['git add -Av', 'add named files only'],
	['git add :/', 'add named files only'],
	['git -c user.name=Synthetic add .', 'add named files only'],
	['git -C . stash', 'git stash is shared by every worktree'],
	['git --no-pager stash list', 'git stash is shared by every worktree'],
	['git --git-dir=.git --work-tree . stash', 'git stash is shared by every worktree'],
	['git -C . commit -m "Synthetic change" --all', 'add named files only'],
	['git reset HEAD~1 --hard', 'destructive git'],
	['git -C . reset --hard', 'destructive git'],
	['git checkout .', 'destructive git'],
	['git checkout -f main', 'destructive git'],
	['git checkout main --force', 'destructive git'],
	['git restore --staged --worktree tool/guard.ts', 'destructive git'],
	['git restore -SW tool/guard.ts', 'destructive git'],
	['git switch --discard-changes main', 'destructive git'],
	['git switch -f main', 'destructive git'],
	['git push -fu origin main', 'force push: use --force-with-lease on your own branch'],
	['git -c core.hooksPath=/dev/null commit -m "Synthetic change"', 'hooks are not optional'],
	['git commit -am "Synthetic change"', 'add named files only'],
	['git reset --hard HEAD', 'destructive git'],
	['git clean -fd', 'destructive git'],
	['git checkout -- tool/guard.ts', 'destructive git'],
	['git restore tool/guard.ts', 'destructive git'],
	['git push --force origin main', 'force push: use --force-with-lease on your own branch'],
	['git push -f origin main', 'force push: use --force-with-lease on your own branch'],
	['git push origin +main', 'force push: use --force-with-lease on your own branch'],
	['git commit --no-verify -m "Synthetic change"', 'hooks are not optional'],
	['git commit -n -m "Synthetic change"', 'hooks are not optional'],
	['LEFTHOOK=0 git commit -m "Synthetic change"', 'hooks are not optional'],
	['git config core.hooksPath /dev/null', 'hooks are not optional'],
	['pkill node', 'kill by process ID only'],
	['killall node', 'kill by process ID only'],
	['npx prettier --write src', 'no whole-tree formatters'],
	['hcloud server list', 'infrastructure needs the founder'],
	['gh repo create strikta/synthetic --public', 'infrastructure needs the founder'],
	['gh secret set SYNTHETIC', 'infrastructure needs the founder'],
	['gh api repos/strikta/synthetic -X DELETE', 'infrastructure needs the founder'],
	['cat .guard.local.yaml', "the local guard file stays on the founder's machine"],
	['ls && pwd; ls', 'no ; chains: use && so a failure stops the chain'],
	['ssh vm', 'remote access needs the founder\'s "deploy"'],
	['rsync -a dist/ vm:site', 'remote access needs the founder\'s "deploy"'],
	['scp dist.tar vm:', 'remote access needs the founder\'s "deploy"']
])('blocks the command %j', (command, reason) => {
	expect(inspect(bash(command), context)).toContain(reason);
});

test.each([
	'git add tool/guard.ts tool/shell.ts',
	'git add ./tool/guard.ts',
	'git commit -m "Add a synthetic change"',
	'git commit --amend -m "Synthetic change"',
	'git push --force-with-lease origin feature/synthetic',
	'git restore --staged tool/guard.ts',
	'git restore -S tool/guard.ts',
	'git -C tool log --oneline',
	'git --no-pager log -1',
	'git checkout -b feature/synthetic',
	'git switch -c feature/synthetic',
	'git switch main',
	'git reset HEAD~1',
	'git push -u origin feature/synthetic',
	'git add tool/guard.ts && git commit -m "Synthetic change"',
	'cat src/../tool/guard.ts',
	'git commit -m "Keep a; b apart"',
	'find tool -name "*.ts" -exec wc -l {} \\;',
	'cat <<EOF > note.md\nline; with a separator\nEOF',
	'npm run lint && npm run check',
	'curl https://strikta.dev',
	'ls content/export 2>/dev/null'
])('allows the command %j', (command) => {
	expect(inspect(bash(command), context)).toEqual([]);
});

test('allows remote access once the founder starts a deploy session', () => {
	expect(inspect(bash('rsync -a dist/ vm:site'), { ...context, deploying: true })).toEqual([]);
});

test.each([
	{ tool_name: 'Read', tool_input: { file_path: join(sibling, 'note.md') } },
	{ tool_name: 'Read', tool_input: { file_path: '../sibling/note.md' } },
	{ tool_name: 'Read', tool_input: { file_path: join(repository, 'linked', 'note.md') } },
	{ tool_name: 'Read', tool_input: { file_path: join(sibling, 'missing', 'deeper.md') } },
	{ tool_name: 'Grep', tool_input: { pattern: 'synthetic', path: sibling } },
	{ tool_name: 'Glob', tool_input: { pattern: `${sibling}/**/*.md` } },
	{ tool_name: 'Glob', tool_input: { pattern: '../**/*.md' } },
	bash('cat ../sibling/note.md'),
	bash('cat ~/note.md'),
	bash(`cat "${sibling}/note.md"`),
	bash(`ls > ${sibling}/listing`),
	bash('git -C ../sibling log'),
	bash('cat linked/../../sibling/note.md'),
	bash('cat content/../../sibling/note.md'),
	{ tool_name: 'Glob', tool_input: { pattern: 'content/../../**' } },
	{ tool_name: 'Grep', tool_input: { pattern: 'synthetic', glob: '../**' } },
	{ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: ../sibling/new.md\n+synthetic\n*** End Patch' } }
])('blocks a path outside the repository: %j', (call) => {
	expect(inspect(call, context).some((finding) => finding.startsWith('path outside this repository'))).toBe(true);
});

test.each([
	{ tool_name: 'Read', tool_input: { file_path: join(repository, 'AGENTS.md') } },
	{ tool_name: 'Read', tool_input: { file_path: 'content/export/quotes.yaml' } },
	{ tool_name: 'Grep', tool_input: { pattern: '/pro/checkout', path: repository } },
	{ tool_name: 'Write', tool_input: { file_path: join(repository, 'src', 'pages', 'index.astro'), content: 'See /pro/checkout and https://strikta.dev' } },
	{ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: src/note.md\n+Links to /legal and ../elsewhere\n*** End Patch' } },
	bash('cat /dev/null')
])('allows a path inside the repository: %j', (call) => {
	expect(inspect(call, context)).toEqual([]);
});

test.each([
	{ tool_name: 'Write', tool_input: { file_path: join(repository, 'content', 'export', 'quotes.yaml'), content: 'schema: 1' } },
	{ tool_name: 'Edit', tool_input: { file_path: 'content/export/legal/terms.md', old_string: 'a', new_string: 'b' } },
	{ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: content/export/legal/terms.md\n*** End Patch' } },
	{ tool_name: 'Write', tool_input: { file_path: 'Content/Export/quotes.yaml', content: 'schema: 1' } },
	{ tool_name: 'Write', tool_input: { file_path: join(repository, 'content', 'EXPORT', 'new.md'), content: 'synthetic' } }
])('blocks an edit to the generated export: %j', (call) => {
	expect(inspect(call, context)).toContain('content/export is generated: a new export is the only fix');
});

test.each([
	{ tool_name: 'Read', tool_input: { file_path: '.guard.local.yaml' } },
	{ tool_name: 'Edit', tool_input: { file_path: join(repository, '.guard.local.yaml'), old_string: 'a', new_string: 'b' } },
	{ tool_name: 'Read', tool_input: { file_path: '.Guard.Local.yaml' } }
])('blocks the local guard file: %j', (call) => {
	expect(inspect(call, context)).toContain("the local guard file stays on the founder's machine");
});

test.each([bash('cat ~other/note.md'), { tool_name: 'Read', tool_input: { file_path: '~other/note.md' } }])('blocks a ~name path: %j', (call) => {
	expect(inspect(call, context).some((finding) => finding.startsWith('a ~name path cannot be resolved'))).toBe(true);
});

test.each([
	bash('curl https://VM.example.test/health'),
	{ tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'Served from vm.example.test' } },
	{ tool_name: 'mcp__synthetic__fetch', tool_input: { url: 'https://vm.example.test' } }
])('blocks a call naming a local host: %j', (call) => {
	expect(inspect(call, context)).toContain('names a production host');
});

test.each([
	bash('echo "EXEMPELGATAN 1" >> notes.md'),
	{ tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'Ship to Exempelgatan\n  1' } },
	{ tool_name: 'mcp__synthetic__send', tool_input: { message: { lines: ['ID 000000-0000'] } } }
])('blocks a call naming a private term: %j', (call) => {
	expect(inspect(call, context)).toContain('names a private term: remove it');
});

test('blocks a private term in an object key', () => {
	expect(inspect({ tool_name: 'mcp__synthetic__send', tool_input: { fields: { 'Exempel\u00adgatan 1': 'street' } } }, context)).toContain('names a private term: remove it');
});

test('warns without blocking when the local guard file is missing or lists no terms, and blocks every call when it cannot be read', () => {
	const call = { tool_name: 'Read', tool_input: { file_path: 'AGENTS.md' } };
	expect(verdict(call, { present: false, hosts: [], terms: [] }, context)).toEqual({ findings: [], warning: '.guard.local.yaml is missing: the private-term rule is off' });
	expect(verdict(call, { present: true, hosts: [], terms: [] }, context)).toEqual({ findings: [], warning: '.guard.local.yaml lists no private_terms: the private-term rule is off' });
	expect(verdict(call, { present: true, hosts: [], terms: [], problem: 'ZZZ problem' }, context)).toEqual({ findings: ['ZZZ problem'], warning: undefined });
	expect(verdict(call, { present: true, hosts: [], terms: ['Exempelgatan 1'] }, context)).toEqual({ findings: [], warning: undefined });
});

test('allows a call without a private term', () => {
	expect(inspect({ tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'Exempelgatan is a synthetic street.' } }, context)).toEqual([]);
});

function run(input: string): { status: number | null; stderr: string } {
	const child = spawnSync(process.execPath, [join(import.meta.dirname, 'guard.ts')], { input, encoding: 'utf8' });
	const outcome = { status: child.status, stderr: child.stderr };
	return outcome;
}

test('the hook exits 2 with the reason when it blocks', () => {
	const outcome = run(JSON.stringify(bash('git stash')));
	expect(outcome.status).toBe(2);
	expect(outcome.stderr).toContain('git stash is shared by every worktree');
});

test('the hook exits 0 for an allowed call', () => {
	expect(run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'AGENTS.md' } })).status).toBe(0);
});

test.each(['', 'not json', '{"tool_name": "Bash"}'])('the hook fails closed on the input %j', (input) => {
	expect(run(input).status).not.toBe(0);
});

test.each(['.claude/settings.json', '.codex/hooks.json'])('the hook wrapper in %s exits 2 when the guard blocks and 0 when it allows', (file) => {
	const settings = hookSchema.parse(JSON.parse(readFileSync(join(root, file), 'utf8')));
	const commands = settings.hooks.PreToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command));
	const statuses = commands.flatMap((command) => [wrapped(command, bash('git stash')), wrapped(command, { tool_name: 'Read', tool_input: { file_path: 'AGENTS.md' } })]);
	expect(commands).not.toEqual([]);
	expect(statuses).toEqual(commands.flatMap(() => [2, 0]));
});

function wrapped(command: string, call: Call): number | null {
	const child = spawnSync('sh', ['-c', command], { cwd: root, input: JSON.stringify(call), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
	return child.status;
}
