import { expect, test } from 'vitest';
import { legalText, plainLine } from './legal.ts';

const text = [
	'# ZZZ Synthetic terms, version 1.0',
	'',
	'These terms are between you and a synthetic company.',
	'',
	'## 1. Scope',
	'1.1 A clause that stays on its own line.',
	'1.2 A second clause with **strong words** and `a command`.',
	'',
	'## 2. Lists and tables',
	'- **First.** One item.',
	'- Second item.',
	'| Data | Kept |',
	'|---|---|',
	'| Name | Two years |',
	''
].join('\n');

test('a legal text keeps its title, preamble and every clause line as it is', () => {
	const legal = legalText(text);
	expect(legal.title).toBe('ZZZ Synthetic terms, version 1.0');
	expect(legal.preamble).toEqual([{ kind: 'paragraph', line: [{ text: 'These terms are between you and a synthetic company.', kind: 'plain' }] }]);
	expect(legal.sections.map((section) => section.heading)).toEqual(['1. Scope', '2. Lists and tables']);
	expect(legal.sections.map((section) => section.blocks.length)).toEqual([2, 2]);
});

test('the file\'s emphasis, list items and table rows become structure without changing a word', () => {
	const [scope, lists] = legalText(text).sections;
	const [, clause] = scope?.blocks ?? [];
	expect(clause).toEqual({
		kind: 'paragraph',
		line: [
			{ text: '1.2 A second clause with ', kind: 'plain' },
			{ text: 'strong words', kind: 'strong' },
			{ text: ' and ', kind: 'plain' },
			{ text: 'a command', kind: 'code' },
			{ text: '.', kind: 'plain' }
		]
	});
	expect(lists?.blocks).toEqual([
		{ kind: 'list', items: [[{ text: 'First.', kind: 'strong' }, { text: ' One item.', kind: 'plain' }], [{ text: 'Second item.', kind: 'plain' }]] },
		{ kind: 'table', head: [[{ text: 'Data', kind: 'plain' }], [{ text: 'Kept', kind: 'plain' }]], rows: [[[{ text: 'Name', kind: 'plain' }], [{ text: 'Two years', kind: 'plain' }]]] }
	]);
});

test('a text without a title keeps its first line', () => {
	expect(legalText('A synthetic line.\n').preamble).toEqual([{ kind: 'paragraph', line: [{ text: 'A synthetic line.', kind: 'plain' }] }]);
});

test('a backslash-escaped mark is plain text without its backslash, outside code', () => {
	expect(legalText('I/We (\\*) give **bold \\* words** and `a\\*b` (\\*).\n').preamble).toEqual([
		{
			kind: 'paragraph',
			line: [
				{ text: 'I/We (*) give ', kind: 'plain' },
				{ text: 'bold * words', kind: 'strong' },
				{ text: ' and ', kind: 'plain' },
				{ text: 'a\\*b', kind: 'code' },
				{ text: ' (*).', kind: 'plain' }
			]
		}
	]);
	expect(plainLine('(\\*) Delete **as** `ap\\*` appropriate.')).toBe('(*) Delete as ap\\* appropriate.');
});

test('the title and headings show without emphasis marks or escaping backslashes', () => {
	const legal = legalText('# ZZZ \\* terms\n\n## 1. **Scope** \\#1\nA clause.\n');
	expect(legal.title).toBe('ZZZ * terms');
	expect(legal.sections.map((section) => section.heading)).toEqual(['1. Scope #1']);
});
