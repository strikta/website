import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { check } from './check.ts';
import { isolated, syntheticExport, unhook, workspace } from './fixture.ts';
import { root } from './local.ts';

const HOSTS = { '.guard.local.yaml': 'hosts: [vm.example.test]\n' };
const LEFTHOOK = join(root, 'node_modules', '.bin', 'lefthook');
const printed = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

unhook();

afterEach(() => {
	printed.mockClear();
	unhook();
});

function run(argv: readonly string[], files: Readonly<Record<string, string>>): { code: number; output: string } {
	const tree = workspace(files);
	const code = check(argv, tree.directory);
	tree.remove();
	const output = printed.mock.calls.map(([chunk]) => String(chunk)).join('');
	return { code, output };
}

test('scan passes clean staged files and prints nothing', () => {
	expect(run(['scan', 'README.md', 'src/components/Price.astro'], { 'README.md': 'Write to ada@example.com.\n', 'src/components/Price.astro': '<p>Price</p>\n' })).toEqual({ code: 0, output: '' });
});

test('scan prints file, line, rule, fix and section', () => {
	const { code, output } = run(['scan', 'README.md'], { 'README.md': 'Intro\nSee ZZZ-RB-000.\n' });
	expect(code).toBe(1);
	expect(output).toContain('README.md:2: internal-id: internal identifier "ZZZ-RB-000": public text never names private records (AGENTS.md, "Hard boundaries")');
});

test('scan applies the path rules', () => {
	const files = { 'src/components/PriceCard.astro': '<p></p>\n', 'data/offer.yaml': 'launch:\n  date: "2030-01-10"\nfounding:\n  end_date: "2030-01-11"\n', '.guard.local.yaml': 'hosts: [vm.example.test]\n', 'notes.md': 'vm.example.test\n' };
	const { output } = run(['scan', 'src/components/PriceCard.astro', 'data/offer.yaml', 'notes.md'], files);
	expect(output).toContain('filename: single-word PascalCase');
	expect(output).toContain('data/offer.yaml:4: founding-date');
	expect(output).toContain('notes.md:1: local-host');
});

test('scan exempts the checker from the identifier rule and skips binary and deleted files', () => {
	const files = { 'tool/rule.ts': 'const shape = "ZZZ-ADR-000";\n', 'public/mark.bin': 'ADR\u0000' };
	expect(run(['scan', 'tool/rule.ts', 'public/mark.bin', 'gone.md'], files).code).toBe(0);
});

test('scan verifies the export when any exported file is staged', () => {
	const files = { ...syntheticExport({ 'legal/terms.md': 'Synthetic.\n' }, []), 'content/export/legal/terms.md': 'Edited.\n' };
	expect(run(['scan', 'content/export/legal/terms.md'], files).output).toContain('quote-hash');
});

test('message rejects a second line', () => {
	expect(run(['message', '.git/COMMIT_EDITMSG'], { '.git/COMMIT_EDITMSG': 'Add the guard\n\nBody\n' }).output).toContain('commit message:1: message: one line in plain English');
});

test('built fails when nothing was built', () => {
	expect(run(['built', 'dist'], {}).output).toContain('nothing built');
});

test('an unknown subcommand prints usage', () => {
	expect(run(['lint'], {}).code).toBe(2);
});

test('the command line exits 1 on a finding and 0 without one', () => {
	const tree = workspace({ 'bad.txt': 'Add the guard\n\nBody\n', 'good.txt': 'Add the guard\n' });
	const exit = (file: string): number | null => spawnSync(process.execPath, [join(import.meta.dirname, 'check.ts'), 'message', join(tree.directory, file)], { env: isolated() }).status;
	expect([exit('bad.txt'), exit('good.txt')]).toEqual([1, 0]);
	tree.remove();
});

type Run = (...argv: readonly string[]) => { readonly status: number | null; readonly output: string };
type Clone = { readonly directory: string; readonly git: Run; readonly install: () => void; readonly remove: () => void };

type Repository = { readonly directory: string; readonly git: (input: string, ...argv: readonly string[]) => string; readonly commit: (message: string, files: Readonly<Record<string, string>>, parent?: string) => string; readonly remove: () => void };

/** A synthetic git repository in a temporary folder; commits are written with plumbing, so no hook runs. */
function repository(files: Readonly<Record<string, string>>): Repository {
	const tree = workspace(files);
	const git = (input: string, ...argv: readonly string[]): string => execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=ada@example.com', ...argv], { cwd: tree.directory, input, encoding: 'utf8', env: isolated() }).trim();
	git('', 'init', '--quiet');
	const commit = (message: string, content: Readonly<Record<string, string>>, parent?: string): string => {
		const entries = Object.entries(content).map(([path, text]) => `100644 blob ${git(text, 'hash-object', '-w', '--stdin')}\t${path}\n`);
		const parents = parent === undefined ? [] : ['-p', parent];
		const sha = git(message, 'commit-tree', git(entries.join(''), 'mktree'), ...parents);
		return sha;
	};
	const created = { directory: tree.directory, git, commit, remove: tree.remove };
	return created;
}

test('a temporary repository leaves the repository that inherited git variables name untouched', () => {
	const decoy = repository({ 'notes.md': 'Synthetic.\n' });
	const before = contents(join(decoy.directory, '.git'));
	vi.stubEnv('GIT_DIR', join(decoy.directory, '.git'));
	vi.stubEnv('GIT_INDEX_FILE', join(decoy.directory, '.git', 'index'));
	const synthetic = repository({});
	synthetic.commit('Start\n', { 'notes.md': 'Synthetic.\n' });
	unhook();
	const after = contents(join(decoy.directory, '.git'));
	const bare = decoy.git('', 'config', '--get', 'core.bare');
	synthetic.remove();
	decoy.remove();
	expect(bare).toBe('false');
	expect(after).toEqual(before);
});

/** Every file under a folder, keyed by its relative path. */
function contents(directory: string): Readonly<Record<string, string>> {
	const paths = readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((path) => statSync(join(directory, path)).isFile());
	const files = Object.fromEntries(paths.map((path) => [path, readFileSync(join(directory, path), 'latin1')] as const));
	return files;
}

function pushedOutput(repository: Repository, tips: readonly string[]): { code: number; output: string } {
	const code = check(['pushed', ...tips], repository.directory);
	const output = printed.mock.calls.map(([chunk]) => String(chunk)).join('');
	return { code, output };
}

test.each([
	['refs/heads/synthetic 0000000000000000000000000000000000000000 refs/heads/synthetic 1111111111111111111111111111111111111111\n', 0],
	['refs/heads/synthetic ZZZ-not-a-revision refs/heads/synthetic 0000000000000000000000000000000000000000\n', 1],
	['refs/heads/ZZZ-RB-000 0000000000000000000000000000000000000000 refs/heads/synthetic 1111111111111111111111111111111111111111\n', 1],
	['refs/heads/synthetic 0000000000000000000000000000000000000000 refs/heads/vm.example.test 1111111111111111111111111111111111111111\n', 1],
	['', 1]
])('pushed reads the local tips and ref names from the pre-push input %j', (input, status) => {
	const synthetic = repository(HOSTS);
	const script = `import { check } from ${JSON.stringify(join(import.meta.dirname, 'check.ts'))}\nprocess.exitCode = check(['pushed'], process.argv[1])\n`;
	const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script, synthetic.directory], { input, encoding: 'utf8', env: isolated() });
	synthetic.remove();
	expect(child.status).toBe(status);
});

test('pushed checks every commit message about to be pushed, merges included', () => {
	const synthetic = repository(HOSTS);
	const first = synthetic.commit('Start\n', {});
	const merge = synthetic.commit('Merge from vm.example.test\n', {}, first);
	const clean = pushedOutput(synthetic, [first]).code;
	const { code, output } = pushedOutput(synthetic, [merge]);
	synthetic.remove();
	expect([clean, code]).toEqual([0, 1]);
	expect(output).toContain(`commit ${merge}:1: local-host`);
});

test('pushed refuses an identifier that an unpushed commit adds and a later one removes, and skips binary content', () => {
	const synthetic = repository({});
	const added = synthetic.commit('Add notes\n', { 'notes.md': 'Intro\nSee ZZZ-RB-000.\n', 'mark.bin': 'ZZZ-RB-000\u0000' });
	const removed = synthetic.commit('Trim notes\n', { 'notes.md': 'Intro\n' }, added);
	const { code, output } = pushedOutput(synthetic, [removed]);
	synthetic.remove();
	expect(code).toBe(1);
	expect(output).toContain('notes.md (in a pushed commit):2: internal-id');
	expect(output).not.toContain('mark.bin');
});

test('pushed applies the path exemptions of scan to pushed content', () => {
	const synthetic = repository({});
	const blob = (text: string): string => synthetic.git(text, 'hash-object', '-w', '--stdin');
	const tool = synthetic.git(`100644 blob ${blob('const shape = "ZZZ-ADR-000";\n')}\trule.ts\n100644 blob ${blob('const address = "ada@mail.invalid";\n')}\trule.test.ts\n`, 'mktree');
	const tip = synthetic.git('Add the checker\n', 'commit-tree', synthetic.git(`040000 tree ${tool}\ttool\n`, 'mktree'));
	const { code } = pushedOutput(synthetic, [tip]);
	synthetic.remove();
	expect(code).toBe(0);
});

test('pushed refuses an identifier in a file name', () => {
	const synthetic = repository({});
	const named = synthetic.commit('Add notes\n', { 'ZZZ-RB-000.md': '' });
	const { code, output } = pushedOutput(synthetic, [named]);
	synthetic.remove();
	expect(code).toBe(1);
	expect(output).toContain(`commit ${named} (file name):1: internal-id`);
});

test('pushed skips content a remote already holds', () => {
	const synthetic = repository({});
	const published = synthetic.commit('Add notes\n', { 'notes.md': 'ZZZ-RB-000\n' });
	synthetic.git('', 'update-ref', 'refs/remotes/origin/main', published);
	const next = synthetic.commit('Add a page\n', { 'notes.md': 'ZZZ-RB-000\n', 'page.md': 'Synthetic.\n' }, published);
	const { code } = pushedOutput(synthetic, [next]);
	synthetic.remove();
	expect(code).toBe(0);
});

test('pushed checks a blob under every path it is committed at, so an exempt path never hides it', () => {
	const synthetic = repository({});
	const added = synthetic.commit('Add notes\n', { 'notes.md': 'ZZZ-RB-000\n' });
	const blob = synthetic.git('ZZZ-RB-000\n', 'hash-object', '-w', '--stdin');
	const tool = synthetic.git(`100644 blob ${blob}\tnotes.md\n`, 'mktree');
	const tip = synthetic.git('Move the notes into the checker folder\n', 'commit-tree', synthetic.git(`040000 tree ${tool}\ttool\n`, 'mktree'), '-p', added);
	const { code, output } = pushedOutput(synthetic, [tip]);
	synthetic.remove();
	expect(code).toBe(1);
	expect(output).toContain('notes.md (in a pushed commit):1: internal-id');
});

test.each([
	['Synthetic page.\n', 0],
	['See ZZZ-RB-000.\n', 1]
])('the pre-push hook checks a branch pushed while another is checked out %j', (notes, status) => {
	const clone = hookedClone();
	clone.git('checkout', '--quiet', '-b', 'probe');
	writeFileSync(join(clone.directory, 'notes.md'), notes);
	clone.git('commit', '--quiet', '--all', '--message', 'Probe');
	clone.git('checkout', '--quiet', 'main');
	clone.install();
	const { status: code, output } = clone.git('push', 'origin', 'refs/heads/probe:refs/heads/probe');
	clone.remove();
	expect([code, output.includes('internal-id')]).toEqual([status, status === 1]);
});

test('the pre-push hook checks a force push that only rewords a commit message', () => {
	const clone = hookedClone();
	clone.git('commit', '--quiet', '--amend', '--message', 'Start ZZZ-RB-000');
	clone.install();
	const { status, output } = clone.git('push', '--force-with-lease', 'origin', 'main');
	clone.remove();
	expect(status).toBe(1);
	expect(output).toContain('internal-id');
});

/** A clone of a bare remote with this repository's hook configuration and checker and a pushed `main`; `install` installs the hooks, so the setup commits run none. */
function hookedClone(): Clone {
	const tree = workspace({ 'clone/notes.md': 'Synthetic.\n' });
	const directory = join(tree.directory, 'clone');
	for (const path of ['lefthook.yml', '.lefthook', 'tool', 'src']) {
		cpSync(join(root, path), join(directory, path), { recursive: true });
	}
	symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
	const git = runner(directory, 'git', '-c', 'user.name=Synthetic', '-c', 'user.email=ada@example.com');
	git('init', '--quiet', '--bare', '../remote.git');
	git('init', '--quiet', '--initial-branch=main');
	git('remote', 'add', 'origin', '../remote.git');
	git('add', 'lefthook.yml', '.lefthook', 'notes.md');
	git('commit', '--quiet', '--message', 'Start');
	git('push', '--quiet', '--set-upstream', 'origin', 'main');
	const clone = { directory, git, install: (): void => { runner(directory, LEFTHOOK)('install'); }, remove: tree.remove };
	return clone;
}

/** Runs a command with fixed leading arguments in a folder, free of the hooked repository's git variables and the user's git configuration, finding lefthook in this repository. */
function runner(directory: string, command: string, ...leading: readonly string[]): Run {
	const environment = { ...isolated(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LEFTHOOK_BIN: LEFTHOOK };
	const run: Run = (...argv) => {
		const child = spawnSync(command, [...leading, ...argv], { cwd: directory, encoding: 'utf8', env: environment });
		const outcome = { status: child.status, output: `${child.stdout}${child.stderr}` };
		return outcome;
	};
	return run;
}
