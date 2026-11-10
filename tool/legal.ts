/** One run of clause text: plain, strong (`**…**` in the file) or code (`` `…` ``). */
type Span = { readonly text: string; readonly kind: 'plain' | 'strong' | 'code' };
export type Line = readonly Span[];
export type Block =
	| { readonly kind: 'paragraph'; readonly line: Line }
	| { readonly kind: 'list'; readonly items: readonly Line[] }
	| { readonly kind: 'table'; readonly head: readonly Line[]; readonly rows: readonly (readonly Line[])[] };
type Section = { readonly heading: string; readonly blocks: readonly Block[] };
export type LegalText = { readonly title: string; readonly preamble: readonly Block[]; readonly sections: readonly Section[] };

const INLINE = /\*\*(?<strong>.+?)\*\*|`(?<code>[^`]+)`/gu;
const ITEM = /^- (?<item>.*)$/u;
export const TABLE_ROW = /^\|(?<cells>.*)\|$/u;
export const TABLE_RULE = /^\|(?:\s*:?-+:?\s*\|)+$/u;
const TITLE = /^# (?<title>.*)$/u;

/**
 * An exported legal text split on its `##` headings. Every clause line is kept as it is: only list items,
 * table rows and the file's own emphasis become markup, and nothing joins, reflows or retypes a line.
 */
export function legalText(text: string): LegalText {
	const [head = '', ...parts] = text.split(/^## /mu);
	const [first = '', ...rest] = head.split('\n');
	const title = TITLE.exec(first)?.groups?.['title'];
	const sections = parts.map((part) => {
		const [heading = '', ...lines] = part.split('\n');
		const section = { heading, blocks: blocks(lines) };
		return section;
	});
	const legal = { title: title ?? '', preamble: blocks(title === undefined ? [first, ...rest] : rest), sections };
	return legal;
}

function blocks(lines: readonly string[]): readonly Block[] {
	const kept = lines.filter((line) => line.trim() !== '');
	const grouped: Block[] = [];
	for (const line of kept) {
		const item = ITEM.exec(line)?.groups?.['item'];
		const cells = TABLE_ROW.exec(line)?.groups?.['cells'];
		const last = grouped[grouped.length - 1];
		if (item !== undefined) {
			appendItem(grouped, last, spans(item));
		} else if (cells !== undefined) {
			appendRow(grouped, last, TABLE_RULE.test(line) ? undefined : cells.split('|').map((cell) => spans(cell.trim())));
		} else {
			grouped.push({ kind: 'paragraph', line: spans(line) });
		}
	}
	return grouped;
}

function appendItem(grouped: Block[], last: Block | undefined, line: Line): void {
	if (last?.kind === 'list') {
		grouped.splice(-1, 1, { kind: 'list', items: [...last.items, line] });
		return;
	}
	grouped.push({ kind: 'list', items: [line] });
}

function appendRow(grouped: Block[], last: Block | undefined, row: readonly Line[] | undefined): void {
	if (last?.kind !== 'table') {
		grouped.push({ kind: 'table', head: row ?? [], rows: [] });
		return;
	}
	if (row !== undefined) {
		grouped.splice(-1, 1, { kind: 'table', head: last.head, rows: [...last.rows, row] });
	}
}

function spans(line: string): Line {
	const runs: Span[] = [];
	let position = 0;
	for (const match of line.matchAll(INLINE)) {
		runs.push({ text: line.slice(position, match.index), kind: 'plain' });
		const strong = match.groups?.['strong'];
		runs.push(strong === undefined ? { text: match.groups?.['code'] ?? '', kind: 'code' } : { text: strong, kind: 'strong' });
		const [whole] = match;
		position = match.index + whole.length;
	}
	runs.push({ text: line.slice(position), kind: 'plain' });
	const filled = runs.filter((run) => run.text !== '');
	return filled;
}
