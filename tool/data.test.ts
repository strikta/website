import { expect, test } from 'vitest';
import { contrastFindings, filenameFindings, foundingFindings } from './data.ts';

const offer = (end: string, after: string): string => `launch:\n  date: "2030-01-10"\nfounding:\n  end_date: "${end}"\n  after_date: "${after}"\n`;

test('accepts an end date 90 days after launch and the day after it', () => {
	expect(foundingFindings('data/offer.yaml', offer('2030-04-10', '2030-04-11'))).toEqual([]);
});

test('accepts an offer whose dates are not filled yet', () => {
	expect(foundingFindings('data/offer.yaml', 'region:\n  us_open: false\n')).toEqual([]);
});

test.each([
	[offer('2030-04-11', '2030-04-12'), 'end date must be launch + 90 days'],
	[offer('2030-04-10', '2030-04-10'), 'after_date must be the day after the end date'],
	['founding:\n  end_date: "2030-04-10"\n', 'end date must be launch + 90 days']
])('rejects the founding dates in %j', (text, fix) => {
	expect(foundingFindings('data/offer.yaml', text).map((finding) => finding.fix)).toContain(fix);
});

const tokens = (pairs: string): string => `color:\n  light: {bg: "#FFFFFF", ink: "#000000", pale: "#EEEEEE", input_border: "#949494"}\ncontrast_tested:\n  light: {${pairs}}\n`;

test('accepts declared pairs that meet AA and match the colours', () => {
	expect(contrastFindings('data/tokens.yaml', tokens('ink_bg: 21, input_border_bg: 3.03'))).toEqual([]);
});

test.each([
	['pale_bg: 1.16', 'contrast below AA: 1.16:1 is under 4.5:1'],
	['ink_bg: 18', 'declared 18 but the colours give 21.00'],
	['ink_paper: 21', '"ink_paper" names no pair of declared colours']
])('rejects the pair %j', (pairs, fix) => {
	expect(contrastFindings('data/tokens.yaml', tokens(pairs)).map((finding) => finding.fix)).toContain(fix);
});

test.each([['src/components/Price.astro', 0], ['src/components/PriceCard.astro', 1], ['src/components/price.astro', 1], ['src/components/Price.ts', 1]])('checks the component name %j', (file, count) => {
	expect(filenameFindings(file)).toHaveLength(count);
});
