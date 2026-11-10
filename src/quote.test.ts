import { expect, test } from 'vitest';
import { syntheticExport, workspace } from '../tool/fixture.ts';
import { filledText, loadExport } from './quote.ts';
import { loadSlots } from './slot.ts';

const data = { 'data/offer.yaml': 'launch:\n  date: "2030-01-10"\n' };

test('a quote is filled from the slots its export names', () => {
	const tree = workspace({ ...data, ...syntheticExport({}, [{ id: 'synthetic-start', text: 'From [start] on.', pages: ['/'], fills: { '[start]': 'launch.date' } }]) });
	const exported = loadExport(`${tree.directory}/content/export`);
	const slots = loadSlots(tree.directory);
	tree.remove();
	expect(exported?.quotes.map((quote) => filledText(quote, slots))).toEqual(['From 2030-01-10 on.']);
});

test('a draft keeps a placeholder no slot fills, and anything else fails on it', () => {
	const tree = workspace(syntheticExport({}, [{ id: 'synthetic-start', text: 'From [start] on.', pages: ['/'], fills: { '[start]': 'launch.date' } }]));
	const [entry] = loadExport(`${tree.directory}/content/export`)?.quotes ?? [];
	const slots = loadSlots(tree.directory);
	tree.remove();
	if (entry === undefined) {
		throw new Error('the synthetic export holds one quote');
	}
	expect(filledText(entry, slots, true)).toBe('From [start] on.');
	expect(() => filledText(entry, slots)).toThrow('Unfilled slot {launch.date}');
});

test('no export yet loads as undefined', () => {
	const tree = workspace({});
	expect(loadExport(`${tree.directory}/content/export`)).toBeUndefined();
	tree.remove();
});
