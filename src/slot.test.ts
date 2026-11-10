import { expect, test } from 'vitest';
import { workspace } from '../tool/fixture.ts';
import { loadSlots, optionalSlot, slot } from './slot.ts';

const data = { 'data/offer.yaml': 'launch:\n  date: "2030-01-10"\nregion:\n  us_open: false\n', 'data/h2h/results.yaml': 'strikta_acc: 0.5\n' };

test('slots come from every data file, with the head-to-head file under h2h', () => {
	const tree = workspace(data);
	const slots = loadSlots(tree.directory);
	tree.remove();
	expect([slot(slots, 'launch.date'), slot(slots, 'region.us_open'), slot(slots, 'h2h.strikta_acc')]).toEqual(['2030-01-10', 'false', '0.5']);
	expect(optionalSlot(slots, 'company.postal_address')).toBeUndefined();
	expect(() => slot(slots, 'company.postal_address')).toThrow('Unfilled slot {company.postal_address}');
});

test('a slot name defined in two files fails', () => {
	const tree = workspace({ ...data, 'data/site.yaml': 'launch:\n  date: "2030-02-01"\n' });
	expect(() => loadSlots(tree.directory)).toThrow('Slot names defined twice in data/ or content/export/: launch');
	tree.remove();
});

test('the export brings the company and Pro facts', () => {
	const tree = workspace({ 'content/export/company.yaml': 'company:\n  postal_address: ZZZ Synthetic Road 1\n', 'content/export/pro.yaml': 'refund:\n  unit: month\n' });
	const slots = loadSlots(tree.directory);
	tree.remove();
	expect([slot(slots, 'company.postal_address'), slot(slots, 'refund.unit')]).toEqual(['ZZZ Synthetic Road 1', 'month']);
});
