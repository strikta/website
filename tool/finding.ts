/** One broken rule, printed as `<file>:<line>: <rule>: <fix>` with the AGENTS.md section to read. */
export type Finding = {
	readonly file: string;
	readonly line: number;
	readonly rule: string;
	readonly fix: string;
	readonly section: string;
};

export function format(finding: Finding): string {
	const line = `${finding.file}:${String(finding.line)}: ${finding.rule}: ${finding.fix} (AGENTS.md, "${finding.section}")`;
	return line;
}

/** The 1-based line of a character position in a text. */
export function lineAt(text: string, position: number): number {
	const line = text.slice(0, Math.max(position, 0)).split('\n').length;
	return line;
}
