import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { check } from './check.ts';
import { isolated, syntheticExport, unhook, workspace } from './fixture.ts';

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
