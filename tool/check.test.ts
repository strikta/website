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

test('message rejects a private term', () => {
	expect(run(['message', 'message'], { ...LOCAL, message: 'Fix 000000-0000\n' }).output).toContain('commit message:1: private-term');
});

test.each([
	['refs/heads/synthetic 0000000000000000000000000000000000000000 refs/heads/synthetic 1111111111111111111111111111111111111111\n', 0],
	['refs/heads/synthetic ZZZ-not-a-revision refs/heads/synthetic 0000000000000000000000000000000000000000\n', 1]
])('pushed reads the local tips from the pre-push input %j', (input, status) => {
	const child = spawnSync(process.execPath, [join(import.meta.dirname, 'check.ts'), 'pushed'], { input, encoding: 'utf8' });
	expect(child.status).toBe(status);
});

test('pushed checks every commit message about to be pushed, merges included', () => {
	const tree = workspace(LOCAL);
	const git = (input: string, ...argv: readonly string[]): string => execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=ada@example.com', ...argv], { cwd: tree.directory, input, encoding: 'utf8' }).trim();
	git('', 'init', '--quiet');
	const empty = git('', 'mktree');
	const first = git('Start\n', 'commit-tree', empty);
	const merge = git('Merge\n\nFrom exempelgatan 1\n', 'commit-tree', empty, '-p', first);
	const codes = [check(['pushed', first], tree.directory), check(['pushed', merge], tree.directory)];
	const output = printed.mock.calls.map(([chunk]) => String(chunk)).join('');
	tree.remove();
	expect(codes).toEqual([0, 1]);
	expect(output).toContain(`commit ${merge}:3: private-term`);
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
