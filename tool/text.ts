import { lineAt, type Finding } from './finding.ts';
import type { Local } from './local.ts';

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
const WHITESPACE = /\s+/u;
const SPECIAL = /[.*+?^${}()|[\]\\/]/gu;
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/gu;

/** The fix printed, and the reason the guard gives, when a text names a private term. */
export const PRIVATE_TERM = 'names a private term: remove it';

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

/** Hosts and private terms listed in the gitignored `.guard.local.yaml`. */
export function localFindings(file: string, text: string, local: Local): readonly Finding[] {
	const findings = [...hostFindings(file, text, local.hosts), ...privateFindings(file, text, local.terms)];
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

/** Private terms listed in the gitignored `.guard.local.yaml`. */
export function privateFindings(file: string, text: string, terms: readonly string[]): readonly Finding[] {
	const normal = normalised(text);
	const findings = matchPositions(normal, terms).map((position) => ({ file, line: lineAt(normal, position), rule: 'private-term', fix: PRIVATE_TERM, section: 'Hard boundaries' }));
	return findings;
}

/** Where any of the terms occurs in the normalised text, ignoring case; the words of a term match with any whitespace or none between them, as a page shows text joined across tags. */
export function termPositions(text: string, terms: readonly string[]): readonly number[] {
	const positions = matchPositions(normalised(text), terms);
	return positions;
}

/** The NFKC form (full-width digits and ligatures folded) without soft hyphens or zero-width characters. */
function normalised(text: string): string {
	const normal = text.replace(INVISIBLE, '').normalize('NFKC');
	return normal;
}

function matchPositions(normal: string, terms: readonly string[]): readonly number[] {
	const positions = terms.map(termPattern).flatMap((pattern) => [...normal.matchAll(pattern)].map((match) => match.index));
	return positions;
}

function termPattern(term: string): RegExp {
	const words = normalised(term).trim().split(WHITESPACE).map((word) => word.replace(SPECIAL, String.raw`\$&`));
	const pattern = new RegExp(words.join(String.raw`\s*`), 'giu');
	return pattern;
}

/** Email addresses outside the example domains and the company's role addresses. */
export function emailFindings(file: string, text: string): readonly Finding[] {
	const findings = [...text.matchAll(EMAIL)]
		.filter((match) => !allowedAddress(match.groups?.['address'] ?? '', match.groups?.['domain'] ?? ''))
		.map((match) => ({ file, line: lineAt(text, match.index), rule: 'email', fix: `"${match.groups?.['address'] ?? ''}": use an example domain`, section: 'Hard boundaries' }));
	return findings;
}

/** A commit message: one line, no co-author trailer, no internal identifier, host or private term. */
export function messageFindings(file: string, text: string, local: Local): readonly Finding[] {
	const lines = text.split('\n').filter((line) => !line.startsWith('#'));
	const content = lines.join('\n').trim();
	const shape = content.includes('\n') || content.length === 0 ? [messageFinding(file, 'one line in plain English')] : [];
	const trailer = TRAILER.test(content) ? [messageFinding(file, 'no AI co-author trailer')] : [];
	const findings = [...shape, ...trailer, ...internalFindings(file, content), ...localFindings(file, content, local)];
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
