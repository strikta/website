import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { check } from './check.ts';
import { syntheticExport, workspace } from './fixture.ts';

const LOCAL = { '.guard.local.yaml': 'private_terms: [Exempelgatan 1, 000000-0000]\n' };
const printed = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

afterEach(() => {
	printed.mockClear();
});

function run(argv: readonly string[], files: Readonly<Record<string, string>>): { code: number; output: string } {
	const tree = workspace(files);
	const code = check(argv, tree.directory);
	tree.remove();
	const output = printed.mock.calls.map(([chunk]) => String(chunk)).join('');
	return { code, output };
}

test('scan passes clean staged files and prints nothing', () => {
	expect(run(['scan', 'README.md', 'src/components/Price.astro'], { ...LOCAL, 'README.md': 'Write to ada@example.com.\n', 'src/components/Price.astro': '<p>Price</p>\n' })).toEqual({ code: 0, output: '' });
});

test('scan flags a private term in any case and spacing', () => {
	const { code, output } = run(['scan', 'notes.md'], { ...LOCAL, 'notes.md': 'Intro\nShip to EXEMPELGATAN\n   1\n' });
	expect(code).toBe(1);
	expect(output).toContain('notes.md:2: private-term: names a private term: remove it (AGENTS.md, "Hard boundaries")');
});

test('scan warns once and passes when the local guard file is missing', () => {
	expect(run(['scan', 'notes.md'], { 'notes.md': 'Exempelgatan 1\n' })).toEqual({ code: 0, output: 'warning: .guard.local.yaml is missing: the private-term rule is off\n' });
});

test('scan flags a private term in a file name', () => {
	const { code, output } = run(['scan', 'Exempelgatan 1.txt'], { ...LOCAL, 'Exempelgatan 1.txt': 'Synthetic.\n' });
	expect(code).toBe(1);
	expect(output).toContain('Exempelgatan 1.txt (file name):1: private-term');
});

test('message rejects a private term', () => {
	expect(run(['message', 'message'], { ...LOCAL, message: 'Fix 000000-0000\n' }).output).toContain('commit message:1: private-term');
});

type Repository = { readonly directory: string; readonly git: (input: string, ...argv: readonly string[]) => string; readonly commit: (message: string, files: Readonly<Record<string, string>>, parent?: string) => string; readonly remove: () => void };

/** A synthetic git repository in a temporary folder; commits are written with plumbing, so no hook runs. */
function repository(files: Readonly<Record<string, string>>): Repository {
	const tree = workspace(files);
	const git = (input: string, ...argv: readonly string[]): string => execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=ada@example.com', ...argv], { cwd: tree.directory, input, encoding: 'utf8' }).trim();
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

function pushedOutput(repository: Repository, tips: readonly string[]): { code: number; output: string } {
	const code = check(['pushed', ...tips], repository.directory);
	const output = printed.mock.calls.map(([chunk]) => String(chunk)).join('');
	return { code, output };
}

test.each([
	['refs/heads/synthetic 0000000000000000000000000000000000000000 refs/heads/synthetic 1111111111111111111111111111111111111111\n', 0],
	['refs/heads/synthetic ZZZ-not-a-revision refs/heads/synthetic 0000000000000000000000000000000000000000\n', 1],
	['refs/heads/Exempelgatan1 0000000000000000000000000000000000000000 refs/heads/synthetic 1111111111111111111111111111111111111111\n', 1],
	['refs/heads/synthetic 0000000000000000000000000000000000000000 refs/tags/Exempelgatan1 1111111111111111111111111111111111111111\n', 1]
])('pushed reads the local tips from the pre-push input %j', (input, status) => {
	const synthetic = repository(LOCAL);
	const script = `import { check } from ${JSON.stringify(join(import.meta.dirname, 'check.ts'))}\nprocess.exitCode = check(['pushed'], process.argv[1])\n`;
	const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script, synthetic.directory], { input, encoding: 'utf8' });
	synthetic.remove();
	expect(child.status).toBe(status);
});

test('pushed checks every commit message about to be pushed, merges included', () => {
	const synthetic = repository(LOCAL);
	const first = synthetic.commit('Start\n', {});
	const merge = synthetic.commit('Merge\n\nFrom exempelgatan 1\n', {}, first);
	const clean = pushedOutput(synthetic, [first]).code;
	const { code, output } = pushedOutput(synthetic, [merge]);
	synthetic.remove();
	expect([clean, code]).toEqual([0, 1]);
	expect(output).toContain(`commit ${merge}:3: private-term`);
});

test('pushed refuses a private term that an unpushed commit adds and a later one removes, on any branch', () => {
	const synthetic = repository(LOCAL);
	const added = synthetic.commit('Add notes\n', { 'notes.md': 'Intro\nShip to Exempelgatan 1\n', 'mark.bin': 'Exempelgatan 1\u0000' });
	const removed = synthetic.commit('Trim notes\n', { 'notes.md': 'Intro\n' }, added);
	const { code, output } = pushedOutput(synthetic, [removed]);
	synthetic.remove();
	expect(code).toBe(1);
	expect(output).toContain('notes.md (in a pushed commit):2: private-term');
	expect(output).not.toContain('mark.bin');
});

test('pushed refuses a private term in a file name, an empty file included, and in the author', () => {
	const synthetic = repository(LOCAL);
	const named = synthetic.commit('Add notes\n', { 'Exempelgatan 1.txt': '' });
	const authored = execFileSync('git', ['-c', 'user.name=Exempelgatan 1', '-c', 'user.email=ada@example.com', 'commit-tree', synthetic.git('', 'mktree'), '-m', 'Start'], { cwd: synthetic.directory, encoding: 'utf8' }).trim();
	const outputs = [pushedOutput(synthetic, [named]), pushedOutput(synthetic, [authored])];
	synthetic.remove();
	expect(outputs.map(({ code }) => code)).toEqual([1, 1]);
	expect(outputs.map(({ output }) => output).join('')).toContain(`commit ${named} (file name):1: private-term`);
	expect(outputs.map(({ output }) => output).join('')).toMatch(new RegExp(`commit ${authored}:\\d+: private-term`, 'u'));
});

test('pushed refuses a private term in an annotated tag message', () => {
	const synthetic = repository(LOCAL);
	const start = synthetic.commit('Start\n', {});
	const tag = synthetic.git(`object ${start}\ntype commit\ntag synthetic\ntagger Synthetic <ada@example.com> 0 +0000\n\nExempelgatan 1\n`, 'mktag');
	const { code, output } = pushedOutput(synthetic, [tag]);
	synthetic.remove();
	expect(code).toBe(1);
	expect(output).toContain(`tag ${tag}:6: private-term`);
});

test('pushed skips content a remote already holds', () => {
	const synthetic = repository(LOCAL);
	const published = synthetic.commit('Add notes\n', { 'notes.md': 'Exempelgatan 1\n' });
	synthetic.git('', 'update-ref', 'refs/remotes/origin/main', published);
	const next = synthetic.commit('Add a page\n', { 'notes.md': 'Exempelgatan 1\n', 'page.md': 'Synthetic.\n' }, published);
	const { code } = pushedOutput(synthetic, [next]);
	synthetic.remove();
	expect(code).toBe(0);
});

test('pushed refuses to run without the local guard file and says to create it', () => {
	const synthetic = repository({});
	const { code, output } = pushedOutput(synthetic, [synthetic.commit('Start\n', {})]);
	synthetic.remove();
	expect(code).toBe(1);
	expect(output).toBe('.guard.local.yaml:1: local-file: missing: create it with your private_terms list before pushing (AGENTS.md, "Hard boundaries")\n');
});

test('reads an unquoted phone number as text, keeping its leading zero', () => {
	expect(run(['scan', 'notes.md'], { '.guard.local.yaml': 'private_terms: [0000000000]\n', 'notes.md': 'Call 0000000000\n' }).output).toContain('notes.md:1: private-term');
});

test.each([
	['private_terms: [{street: Exempelgatan 1}]\n', '.guard.local.yaml:1: local-file: .guard.local.yaml is invalid at private_terms.0: Invalid input: expected string, received object: fix it by hand'],
	['private_terms: [\n', '.guard.local.yaml:1: local-file: .guard.local.yaml is invalid at line 2 (not valid YAML): fix it by hand']
])('refuses an unreadable local guard file %j without quoting it', (content, finding) => {
	const { code, output } = run(['scan', 'notes.md'], { '.guard.local.yaml': content, 'notes.md': 'Synthetic.\n' });
	expect(code).toBe(1);
	expect(output).toContain(finding);
	expect(output).not.toContain('Exempelgatan');
});

test('warns when the local guard file lists no private terms', () => {
	expect(run(['message', 'message'], { '.guard.local.yaml': 'private_terms:\n', message: 'Fix the page\n' })).toEqual({ code: 0, output: 'warning: .guard.local.yaml lists no private_terms: the private-term rule is off\n' });
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
	const exit = (file: string): number | null => spawnSync(process.execPath, [join(import.meta.dirname, 'check.ts'), 'message', join(tree.directory, file)]).status;
	expect([exit('bad.txt'), exit('good.txt')]).toEqual([1, 0]);
	tree.remove();
});
