import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { inspect, type Call, type Context } from './guard.ts';

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'guard-')));
const repository = join(workspace, 'repository');
const sibling = join(workspace, 'sibling');
mkdirSync(join(repository, 'content', 'export'), { recursive: true });
mkdirSync(sibling);
writeFileSync(join(sibling, 'note.md'), 'synthetic');
symlinkSync(sibling, join(repository, 'linked'));

const context: Context = { root: repository, allowed: ['/dev/null'], hosts: ['vm.example.test'], deploying: false, home: sibling };

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
	{ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: content/export/legal/terms.md\n*** End Patch' } }
])('blocks an edit to the generated export: %j', (call) => {
	expect(inspect(call, context)).toContain('content/export is generated: a new export is the only fix');
});

test.each([
	{ tool_name: 'Read', tool_input: { file_path: '.guard.local.yaml' } },
	{ tool_name: 'Edit', tool_input: { file_path: join(repository, '.guard.local.yaml'), old_string: 'a', new_string: 'b' } }
])('blocks the local guard file: %j', (call) => {
	expect(inspect(call, context)).toContain("the local guard file stays on the founder's machine");
});

test.each([
	bash('curl https://VM.example.test/health'),
	{ tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'Served from vm.example.test' } },
	{ tool_name: 'mcp__synthetic__fetch', tool_input: { url: 'https://vm.example.test' } }
])('blocks a call naming a local host: %j', (call) => {
	expect(inspect(call, context)).toContain('names a production host');
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
