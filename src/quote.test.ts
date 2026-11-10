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

test('no export yet loads as undefined', () => {
	const tree = workspace({});
	expect(loadExport(`${tree.directory}/content/export`)).toBeUndefined();
	tree.remove();
});
