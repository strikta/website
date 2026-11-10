import { expect, test } from 'vitest';
import { workspace } from '../tool/fixture.ts';
import { covers, loadStage, priced, stageRoutes, withheld } from './stage.ts';

const table = [
	'current: s1',
	'routes:',
	'  - {path: /, stages: [s1]}',
	'  - {path: /pro/checkout, stages: [s3]}',
	'  - {path: /docs/**, stages: [s1]}',
	'withheld:',
	'  - {route: /, stages: [s1], quotes: [synthetic-price]}',
	'  - {route: /, stages: [s3], quotes: [synthetic-later]}',
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
