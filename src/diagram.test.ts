import { expect, test } from 'vitest';
import { workspace } from '../tool/fixture.ts';
import { diagramStyles, findTurn, loadDemo, loadExcerpt, loadFacts, loadReplay } from './diagram.ts';

const WINDOW = ['- turn: ZZZ1', '  source: brand-guide', '  sections:', '    - {name: system, start: 0, end: 9}', '    - {name: message, start: 10, end: 39, selected: true}', ''].join('\n');
const FACTS = ['source: brand-guide', 'facts:', '  - {id: ZZZ-fact, state: superseded, text: Synthetic., start: 10, end: 40, successor: ZZZ-next}', '  - {id: ZZZ-next, state: current, text: Synthetic., start: 40}', ''].join('\n');

test('row heights are proportional to bytes, and each fact gets its validity, in a stylesheet with no inline style', () => {
	const tree = workspace({ 'data/window.yaml': WINDOW, 'data/fact.yaml': FACTS });
	const styles = diagramStyles(tree.directory);
	tree.remove();
	expect(styles).toBe(
		[
			'.window[data-turn="ZZZ1"] { grid-template-rows: minmax(var(--s-space-4), 10fr) minmax(var(--s-space-4), 30fr); --count: 2; }',
			'[data-fact="ZZZ-fact"] { --start: 10; --end: 40; }',
			'[data-fact="ZZZ-next"] { --start: 40; --end: 100; }',
			''
		].join('\n')
	);
});

test('a missing turn fails the build with the fix', () => {
	const tree = workspace({ 'data/window.yaml': WINDOW });
	expect(() => findTurn(tree.directory, 'ZZZ9')).toThrow('No turn ZZZ9 in data/window.yaml');
	tree.remove();
});

test('hand-written diagrams pass while the stage publishes no release, and fail the build once it does', () => {
	const before = workspace({ 'data/window.yaml': WINDOW, 'data/stage.yaml': 'current: s1\nroutes:\n  - {path: /, stages: [s1]}\n  - {path: /docs/**, stages: [s2]}\n' });
	expect(findTurn(before.directory, 'ZZZ1').sections).toHaveLength(2);
	before.remove();
	const after = workspace({ 'data/window.yaml': WINDOW, 'data/stage.yaml': 'current: s2\nroutes:\n  - {path: /docs/**, stages: [s2]}\n' });
	expect(() => findTurn(after.directory, 'ZZZ1')).toThrow('still marked source: brand-guide');
	after.remove();
});

test('the site\'s diagram data is synthetic and complete: the replay turns exist, every successor is a fact', () => {
	const root = process.cwd();
	const replay = loadReplay(root);
	const facts = loadFacts(root);
	const identifiers = facts.map((fact) => fact.id);
	expect(findTurn(root, replay.from).sections.length).toBeGreaterThan(0);
	expect(findTurn(root, replay.to).candidates.length).toBeGreaterThan(0);
	expect(facts.flatMap(({ successor }) => (successor === undefined ? [] : [successor])).every((successor) => identifiers.includes(successor))).toBe(true);
	expect(loadExcerpt(root).rules).toContain('[Standing Rules]');
});

test('real product output is read from demo/, and a missing file fails the build with the fix', () => {
	const tree = workspace({ 'demo/inspect-turn.txt': 'turn ZZZ1\n\n' });
	expect(loadDemo(tree.directory, 'inspect-turn.txt')).toBe('turn ZZZ1');
	expect(() => loadDemo(tree.directory, 'list-rules.txt')).toThrow('No demo/list-rules.txt');
	tree.remove();
});
