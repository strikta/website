import { expect, test } from 'vitest';
import { workspace } from '../tool/fixture.ts';
import { covers, happened, loadStage, priced, stageRoutes, withheld } from './stage.ts';

const table = [
	'current: prelaunch',
	'routes:',
	'  - {path: /, stages: [prelaunch]}',
	'  - {path: /pro/checkout, stages: [stage2]}',
	'  - {path: /docs/**, stages: [prelaunch]}',
	'withheld:',
	'  - {route: /, stages: [prelaunch], quotes: [synthetic-price]}',
	'  - {route: /, stages: [stage2], quotes: [synthetic-later]}',
	''
].join('\n');

test('the current stage builds only its own routes and holds back its sections', () => {
	const tree = workspace({ 'data/stage.yaml': table });
	const stage = loadStage(tree.directory);
	tree.remove();
	expect(stage === undefined ? [] : stageRoutes(stage)).toEqual(['/', '/docs/**']);
	expect(stage === undefined ? [] : ['synthetic-price', 'synthetic-later'].filter((quote) => withheld(stage, '/', quote))).toEqual(['synthetic-price']);
	expect(stage !== undefined && withheld(stage, '/docs/**', 'synthetic-price')).toBe(false);
	expect(stage !== undefined && priced(stage)).toBe(false);
});

test('no stage table loads as undefined', () => {
	const tree = workspace({});
	expect(loadStage(tree.directory)).toBeUndefined();
	tree.remove();
});

test.each([
	['/', '/', true],
	['/docs/**', '/docs', true],
	['/docs/**', '/docs/start', true],
	['/docs/**', '/docsearch', false],
	['/.well-known/security.txt', '/.well-known/security.txt', false],
	['/pro', '/pro/checkout', false]
])('the entry %s covers %s: %s', (entry, route, expected) => {
	expect(covers(entry, route)).toBe(expected);
});

test('an event shows its sections only once it has happened, and an event the table does not name fails the build', () => {
	const tree = workspace({ 'data/stage.yaml': `${table}events: {zzz_done: true, zzz_waiting: false}\n` })
	const stage = loadStage(tree.directory);
	tree.remove();
	expect(stage === undefined ? [] : [happened(stage, 'zzz_done'), happened(stage, 'zzz_waiting')]).toEqual([true, false]);
	expect(() => stage !== undefined && happened(stage, 'zzz_unknown')).toThrow('No event "zzz_unknown"');
});
