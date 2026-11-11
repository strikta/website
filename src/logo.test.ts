import { expect, test } from 'vitest';
import { workspace } from '../tool/fixture.ts';
import { artwork } from './logo.ts';

test('the mark is two blocks either side of the cut, in a 24-unit square', () => {
	const mark = artwork(process.cwd(), 'mark');
	expect(mark).toEqual({ viewBox: '0 0 24 24', shapes: ['M0 0L12.5 0L8.5 24L0 24Z', 'M15.5 0L24 0L24 24L11.5 24Z'] });
});

test('the lockup is the mark and the inclined wordmark, 165 by 24 units', () => {
	const lockup = artwork(process.cwd(), 'lockup');
	expect(lockup.viewBox).toBe('0 0 165 24');
	expect(lockup.shapes.slice(0, 2)).toEqual(artwork(process.cwd(), 'mark').shapes);
	expect(lockup.shapes.length).toBeGreaterThan(2);
});

test('a logo file without a path fails the build', () => {
	const tree = workspace({ 'public/brand/ZZZ.svg': '<svg viewBox="0 0 1 1"></svg>' });
	expect(() => artwork(tree.directory, 'ZZZ')).toThrow('has no view box or no path');
	tree.remove();
});
