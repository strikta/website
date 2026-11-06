import { lineAt, type Finding } from './finding.ts';

const INTERNAL_PATTERNS: readonly RegExp[] = [
	/(?<found>\b(?:[A-Z]{2,6}-)?(?:ADR|LR|EXP|RF|RB|REF)-\d{3}\b)/gu,
	/(?<found>\bADR\b)/gu,
	/(?<found>\bbacklog\b)/giu,
	/(?<found>\.project-knowledge)/gu,
	/(?<found>\.docs\/)/gu
];
const EMAIL = /(?<address>[\w.%+-]+@(?<domain>(?:[a-z0-9-]+\.)+[a-z]{2,}))\b/giu;
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|[a-z0-9-]+\.test)$/u;
const ROLE_ADDRESS = /^(?:support|licensing|security|legal)@strikta\.dev$/u;
const TRAILER = /^co-authored-by:/imu;

/** Internal identifiers: record IDs, the record and task-list names, private folder names. */
export function internalFindings(file: string, text: string): readonly Finding[] {
	const findings = INTERNAL_PATTERNS.flatMap((pattern) =>
		[...text.matchAll(pattern)].map((match) => ({
			file,
			line: lineAt(text, match.index),
			rule: 'internal-id',
			fix: `internal identifier "${match.groups?.['found'] ?? ''}": public text never names private records`,
			section: 'Hard boundaries'
		}))
	);
	return findings;
}

/** Host names listed in the gitignored `.guard.local.yaml`. */
export function hostFindings(file: string, text: string, hosts: readonly string[]): readonly Finding[] {
	const lowered = text.toLowerCase();
	const findings = hosts
		.map((host) => lowered.indexOf(host.toLowerCase()))
		.filter((position) => position >= 0)
		.map((position) => ({ file, line: lineAt(text, position), rule: 'local-host', fix: 'names a production host', section: 'Hard boundaries' }));
	return findings;
}

/** Email addresses outside the example domains and the company's role addresses. */
export function emailFindings(file: string, text: string): readonly Finding[] {
	const findings = [...text.matchAll(EMAIL)]
		.filter((match) => !allowedAddress(match.groups?.['address'] ?? '', match.groups?.['domain'] ?? ''))
		.map((match) => ({ file, line: lineAt(text, match.index), rule: 'email', fix: `"${match.groups?.['address'] ?? ''}": use an example domain`, section: 'Hard boundaries' }));
	return findings;
}

/** A commit message: one line, no co-author trailer, no internal identifier or host. */
export function messageFindings(file: string, text: string, hosts: readonly string[]): readonly Finding[] {
	const lines = text.split('\n').filter((line) => !line.startsWith('#'));
	const content = lines.join('\n').trim();
	const shape = content.includes('\n') || content.length === 0 ? [messageFinding(file, 'one line in plain English')] : [];
	const trailer = TRAILER.test(content) ? [messageFinding(file, 'no AI co-author trailer')] : [];
	const findings = [...shape, ...trailer, ...internalFindings(file, content), ...hostFindings(file, content, hosts)];
	return findings;
}

function messageFinding(file: string, fix: string): Finding {
	const finding = { file, line: 1, rule: 'message', fix, section: 'Git and pull requests' };
	return finding;
}

function allowedAddress(address: string, domain: string): boolean {
	const allowed = EXAMPLE_DOMAIN.test(domain.toLowerCase()) || ROLE_ADDRESS.test(address.toLowerCase());
	return allowed;
}
