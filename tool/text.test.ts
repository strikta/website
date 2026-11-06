import { expect, test } from 'vitest';
import { emailFindings, hostFindings, internalFindings, messageFindings } from './text.ts';

const hosts = ['vm.example.test'];

test.each(['See ZZZ-ADR-000 for the reason.', 'The ADR says so.', 'Moved to the Backlog.', 'Read .project-knowledge first.', 'Notes in .docs/plan.md'])('flags the internal identifier in %j', (text) => {
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

test.each(['Add the guard\n', 'Add the guard\n# Please enter the commit message\n'])('accepts the message %j', (text) => {
	expect(messageFindings('message', text, hosts)).toEqual([]);
});

test.each([
	['Add the guard\n\nWith a body\n', 'one line in plain English'],
	['\n', 'one line in plain English'],
	['Add the guard\nCo-authored-by: Synthetic <ada@example.com>\n', 'no AI co-author trailer'],
	['Implement ZZZ-ADR-000\n', 'internal identifier "ZZZ-ADR-000": public text never names private records'],
	['Point the site at vm.example.test\n', 'names a production host']
])('rejects the message %j', (text, fix) => {
	expect(messageFindings('message', text, hosts).map((finding) => finding.fix)).toContain(fix);
});
