import { expect, test } from 'vitest';
import type { Local } from './local.ts';
import { emailFindings, hostFindings, internalFindings, messageFindings, privateFindings, termPositions } from './text.ts';

const hosts = ['vm.example.test'];
const terms = ['Exempelgatan 1', '000 00  Exempelby', '+00 (0)0-000 00', '000000-0000'];
const local: Local = { present: true, hosts, terms };

test.each(['See ZZZ-ADR-000 for the reason.', 'See EXP-000.', 'LR-000 says so.', 'RF-000', 'The RB-000 steps', 'REF-000', 'The ADR says so.', 'Moved to the Backlog.', 'Read .project-knowledge first.', 'Notes in .docs/plan.md'])('flags the internal identifier in %j', (text) => {
	expect(internalFindings('page.md', text).map((finding) => finding.rule)).toContain('internal-id');
});

test.each(['A decision is recorded privately.', 'adrenaline', 'src/content/docs/index.md'])('passes %j', (text) => {
	expect(internalFindings('page.md', text)).toEqual([]);
});

test('reports the line of the identifier', () => {
	expect(internalFindings('page.md', 'first\nsecond ZZZ-LR-000').map((finding) => finding.line)).toEqual([2]);
});

test.each(['ada@example.com', 'ada@mail.example.org', 'ada@example.net', 'ada@shop.test', 'support@strikta.dev', 'legal@strikta.dev', 'lefthook@2.2.2'])('allows the address %j', (text) => {
	expect(emailFindings('page.md', text)).toEqual([]);
});

test.each(['ada@elsewhere.org', 'founder@strikta.dev', 'ada@example.company'])('flags the address %j', (text) => {
	expect(emailFindings('page.md', text).map((finding) => finding.rule)).toEqual(['email']);
});

test('flags a local host in any case', () => {
	expect(hostFindings('page.md', 'Served from VM.Example.Test', hosts).map((finding) => finding.rule)).toEqual(['local-host']);
});

test.each(['exempelgatan 1', 'EXEMPELGATAN\t\n 1', '000 00 exempelby', '000\u00a000\nExempelby', 'Call +00 (0)0-000  00', 'Born 000000-0000.'])('flags the private term in %j', (text) => {
	expect(privateFindings('page.md', text, terms).map((finding) => finding.fix)).toEqual(['names a private term: remove it']);
});

test.each(['Exempelgatan', 'Exempelgatan, 1', '00000 Exempelby', '+00 00-000 00', '000000 0000', '000000x0000'])('passes %j without a private term', (text) => {
	expect(termPositions(text, terms)).toEqual([]);
});

test('matches a decomposed accent against a composed term', () => {
	expect(termPositions('Ligger på Exempelva\u0308gen', ['Exempelvägen'])).toEqual([10]);
	expect(privateFindings('page.md', 'Exempelvägen', ['Exempelva\u0308gen'])).toHaveLength(1);
});

test.each(['Exempel\u00adgatan 1', 'Exem\u200bpel\u200dgatan\u2060 1', '\ufeffExempelgatan \uff11', '\uff10\uff10\uff10\uff10\uff10\uff10-0000', 'Exempelga\u200b\u0308tan 1'])('matches the NFKC form without hidden characters in %j', (text) => {
	expect(termPositions(text, ['Exempelgatan 1', '000000-0000', 'Exempelgätan 1']).length).toBeGreaterThan(0);
});

test('reports the line of a private term after hidden characters are removed', () => {
	expect(privateFindings('page.md', 'first\u200b\nsecond Exempel\u00adgatan 1', terms).map((finding) => finding.line)).toEqual([2]);
});

test('reports the line of a private term and passes without any terms', () => {
	expect(privateFindings('page.md', 'first\nsecond 000000-0000', terms).map((finding) => finding.line)).toEqual([2]);
	expect(termPositions('Exempelgatan 1', [])).toEqual([]);
});

test.each(['Add the guard\n', 'Add the guard\n# Please enter the commit message\n'])('accepts the message %j', (text) => {
	expect(messageFindings('message', text, local)).toEqual([]);
});

test.each([
	['Add the guard\n\nWith a body\n', 'one line in plain English'],
	['\n', 'one line in plain English'],
	['Add the guard\nCo-authored-by: Synthetic <ada@example.com>\n', 'no AI co-author trailer'],
	['Implement ZZZ-ADR-000\n', 'internal identifier "ZZZ-ADR-000": public text never names private records'],
	['Point the site at vm.example.test\n', 'names a production host'],
	['Move to exempelgatan 1\n', 'names a private term: remove it']
])('rejects the message %j', (text, fix) => {
	expect(messageFindings('message', text, local).map((finding) => finding.fix)).toContain(fix);
});
