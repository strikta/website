type Heredoc = { readonly delimiter: string; readonly strip: boolean };
type Scan = { readonly text: string; position: number; readonly pending: Heredoc[] };
type Step = (scan: Scan) => boolean;

const HEREDOC_WORD = /^(?<word>(?:'[^']*'|"[^"]*"|\\.|[^\s;&|<>()'"\\])+)/u;
const WORD_START = /[\s;&|()<>]/u;

/**
 * Whether a shell command uses `;` as a command separator: outside quotes, comments and
 * here-documents. An unterminated quote or here-document counts as one, so callers fail closed.
 */
export function separated(command: string): boolean {
	const scan: Scan = { text: command, position: 0, pending: [] };
	let found = false;
	while (!found && scan.position < command.length) {
		const step = STEPS.get(command.charAt(scan.position)) ?? plain;
		found = step(scan);
	}
	const unfinished = scan.pending.length > 0;
	return found || unfinished;
}

function plain(scan: Scan): boolean {
	scan.position += 1;
	return false;
}

function separator(): boolean {
	return true;
}

function single(scan: Scan): boolean {
	const end = scan.text.indexOf("'", scan.position + 1);
	scan.position = end + 1;
	const unterminated = end < 0;
	return unterminated;
}

function double(scan: Scan): boolean {
	scan.position += 1;
	let found = false;
	while (!found && scan.position < scan.text.length && scan.text.charAt(scan.position) !== '"') {
		const step = QUOTED_STEPS.get(scan.text.charAt(scan.position)) ?? plain;
		found = step(scan);
	}
	scan.position += 1;
	const unterminated = scan.position > scan.text.length;
	return found || unterminated;
}

function dollar(scan: Scan): boolean {
	const next = scan.text.charAt(scan.position + 1);
	const ansi = next === "'" ? escaped(scan, "'", scan.position + 2) : undefined;
	const found = ansi ?? (next === '(' ? substitution(scan, 2, ')') : plain(scan));
	return found;
}

function quotedDollar(scan: Scan): boolean {
	const found = scan.text.charAt(scan.position + 1) === '(' ? substitution(scan, 2, ')') : plain(scan);
	return found;
}

function backtick(scan: Scan): boolean {
	return substitution(scan, 1, '`');
}

/** A command substitution: its body is scanned like a command up to the closing character. */
function substitution(scan: Scan, opening: number, closing: string): boolean {
	scan.position += opening;
	let found = false;
	while (!found && scan.position < scan.text.length && scan.text.charAt(scan.position) !== closing) {
		const step = STEPS.get(scan.text.charAt(scan.position)) ?? plain;
		found = step(scan);
	}
	scan.position += 1;
	const unterminated = scan.position > scan.text.length;
	return found || unterminated;
}

function escaped(scan: Scan, quote: string, start: number): boolean {
	let position = start;
	while (position < scan.text.length && scan.text.charAt(position) !== quote) {
		position += scan.text.charAt(position) === '\\' ? 2 : 1;
	}
	scan.position = position + 1;
	const unterminated = position >= scan.text.length;
	return unterminated;
}

function backslash(scan: Scan): boolean {
	scan.position += 2;
	return false;
}

function comment(scan: Scan): boolean {
	const starts = scan.position === 0 || WORD_START.test(scan.text.charAt(scan.position - 1));
	const end = scan.text.indexOf('\n', scan.position);
	scan.position = starts ? (end < 0 ? scan.text.length : end) : scan.position + 1;
	return false;
}

function redirect(scan: Scan): boolean {
	const herestring = scan.text.startsWith('<<<', scan.position);
	const heredoc = !herestring && scan.text.startsWith('<<', scan.position);
	scan.position += herestring ? 3 : heredoc ? 2 : 1;
	const malformed = heredoc && !openHeredoc(scan);
	return malformed;
}

function openHeredoc(scan: Scan): boolean {
	const strip = scan.text.charAt(scan.position) === '-';
	const rest = scan.text.slice(scan.position + (strip ? 1 : 0));
	const trimmed = rest.replace(/^[ \t]+/u, '');
	const word = HEREDOC_WORD.exec(trimmed)?.groups?.['word'];
	if (word === undefined) {
		return false;
	}
	scan.pending.push({ delimiter: word.replace(/['"\\]/gu, ''), strip });
	scan.position += (strip ? 1 : 0) + rest.length - trimmed.length + word.length;
	return true;
}

function newline(scan: Scan): boolean {
	scan.position += 1;
	const bodies = scan.pending.splice(0);
	const unterminated = bodies.some((heredoc) => !skipBody(scan, heredoc));
	return unterminated;
}

function skipBody(scan: Scan, heredoc: Heredoc): boolean {
	let closed = false;
	while (!closed && scan.position < scan.text.length) {
		const end = scan.text.indexOf('\n', scan.position);
		const line = scan.text.slice(scan.position, end < 0 ? undefined : end);
		scan.position = end < 0 ? scan.text.length : end + 1;
		closed = (heredoc.strip ? line.replace(/^\t+/u, '') : line) === heredoc.delimiter;
	}
	return closed;
}

const STEPS: ReadonlyMap<string, Step> = new Map<string, Step>([
	[';', separator],
	["'", single],
	['"', double],
	['$', dollar],
	['\\', backslash],
	['#', comment],
	['<', redirect],
	['\n', newline]
]);
const QUOTED_STEPS: ReadonlyMap<string, Step> = new Map<string, Step>([
	['\\', backslash],
	['$', quotedDollar],
	['`', backtick]
]);
