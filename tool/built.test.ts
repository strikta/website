import { join } from 'node:path';
import { expect, test } from 'vitest';
import { builtFindings, visibleText } from './built.ts';
import { syntheticExport, workspace } from './fixture.ts';

const stage = 'current: S1\nroutes:\n  - {path: /, stages: [S1]}\n  - {path: /legal, stages: [S1]}\n  - {path: /pro/checkout, stages: [S3]}\n  - {path: /docs/**, stages: [S2]}\n  - {path: /.well-known/security.txt, stages: [S1]}\n';
const page = (body: string): string => `<!doctype html><html><head><title>Synthetic</title><link rel="stylesheet" href="/_astro/site.css"></head><body>${body}</body></html>`;
const quotes = [{ id: 'synthetic-start', text: 'Starts on [start date].', pages: ['/legal'], fills: { '[start date]': 'launch.date' } }];

function site(overrides: Readonly<Record<string, string>>): Record<string, string> {
	const files = {
		'data/stage.yaml': stage,
		'data/offer.yaml': 'launch:\n  date: "2030-01-10"\n',
		'dist/index.html': page('<main><p>A synthetic home page.</p></main>'),
		'dist/legal/index.html': page('<p>Starts on\n  2030-01-10.</p>'),
		'dist/.well-known/security.txt': 'Contact: mailto:security@strikta.dev\n',
		'dist/_astro/site.css': 'body { font-family: "Plex", sans-serif; }',
		...syntheticExport({}, quotes),
		...overrides
	};
	return files;
}

function fixes(overrides: Readonly<Record<string, string>>, hosts?: readonly string[]): readonly string[] {
	const tree = workspace(site(overrides));
	const found = builtFindings(join(tree.directory, 'dist'), tree.directory, hosts ?? []).map((finding) => `${finding.rule}: ${finding.fix}`);
	tree.remove();
	return found;
}

test('a clean synthetic build passes', () => {
	expect(fixes({})).toEqual([]);
});

test.each([
	['<p>Starts on {launch.date}.</p>', 'placeholder: unfilled slot or placeholder'],
	['<p>Starts on [launch date].</p>', 'placeholder: unfilled slot or placeholder'],
	['<p>€99 a year: save 34%</p>', 'price-words: no %, save, discount or countdown near a price'],
	['<p>Only 3 days left at &euro;99</p>', 'price-words: no %, save, discount or countdown near a price'],
	['<img src="https://cdn.example.com/a.png" alt="">', 'third-party: "https://cdn.example.com/a.png": no third-party request; self-host it'],
	['<script src="//cdn.example.com/a.js"></script>', 'third-party: "//cdn.example.com/a.js": no third-party request; self-host it'],
	['<p>See ZZZ-ADR-000.</p>', 'internal-id: internal identifier "ZZZ-ADR-000": public text never names private records'],
	['<p>Write to ada@elsewhere.org</p>', 'email: "ada@elsewhere.org": use an example domain'],
	['<a href="/legal" ping="https://track.example.com/hit">Legal</a>', 'third-party: "https://track.example.com/hit": no third-party request; self-host it'],
	['<meta http-equiv="refresh" content="0; url=https://elsewhere.example.com/">', 'third-party: "https://elsewhere.example.com/": no third-party request; self-host it']
])('flags the home page body %j', (body, fix) => {
	expect(fixes({ 'dist/index.html': page(body) })).toContain(fix);
});

test.each([
	'<a href="https://github.com/strikta/strikta">Source</a> <a href="https://example.com">Example</a>',
	'<p>Write to support@strikta.dev</p>',
	'<script>const slots = "{launch.date}";</script><p>Fine.</p>',
	'<img src="/font/mark.svg" alt="Strikta"> <img src="https://strikta.dev/mark.svg" alt="">'
])('passes the home page body %j', (body) => {
	expect(fixes({ 'dist/index.html': page(body) })).toEqual([]);
});

test('flags a price figure on a stage that publishes none, but not one in a link target', () => {
	expect(fixes({ 'dist/index.html': page('<p>From &euro;1,500 a year.</p>') })).toEqual(['price-figure: "€1,500": stage S1 publishes no price figure; hold the section back in data/stage.yaml']);
	expect(fixes({ 'dist/index.html': page('<p>Revenue under 2 EUR.</p>') })).toEqual(['price-figure: "2 EUR": stage S1 publishes no price figure; hold the section back in data/stage.yaml']);
	expect(fixes({ 'dist/index.html': page('<a href="mailto:licensing@strikta.dev?body=under%20%E2%82%AC1M">Email</a>') })).toEqual([]);
});

test('a stage that publishes prices may show a price figure', () => {
	expect(fixes({ 'data/stage.yaml': `${stage}priced: [S1]\n`, 'dist/index.html': page('<p>€99 a year.</p><p>Save your work often.</p>') })).toEqual([]);
});

test('flags a third-party import in a stylesheet', () => {
	expect(fixes({ 'dist/_astro/site.css': '@import url("https://fonts.example.com/plex.css");' })).toContain(
		'third-party: "https://fonts.example.com/plex.css": no third-party request; self-host it'
	);
});

test.each(['dist/_astro/copy.js', 'dist/_astro/copy.mjs'])('flags an absolute off-origin URL in the script %s', (file) => {
	expect(fixes({ [file]: 'fetch("https://api.example.com/v1");' })).toContain('third-party: "https://api.example.com/v1": no third-party request; self-host it');
});

test('passes a script that only calls its own origin', () => {
	expect(fixes({ 'dist/_astro/copy.js': 'fetch("/api");fetch("https://strikta.dev/api");' })).toEqual([]);
});

test('flags a quote that is not on its page', () => {
	expect(fixes({ 'dist/legal/index.html': page('<p>Starts soon.</p>') })).toEqual([
		'quote-presence: quote "synthetic-start" is missing: render it with <Quote>; never retype it'
	]);
});

test('a quote the stage holds back on a page is not looked for there', () => {
	const held = `${stage}withheld:\n  - {route: /legal, stages: [S1], quotes: [synthetic-start]}\n`;
	expect(fixes({ 'data/stage.yaml': held, 'dist/legal/index.html': page('<p>Starts soon.</p>') })).toEqual([]);
});

test('a quote held back on one page is still looked for on its other pages', () => {
	const twice = syntheticExport({}, quotes.map((quote) => ({ ...quote, pages: ['/', '/legal'] })));
	const held = `${stage}withheld:\n  - {route: /legal, stages: [S1], quotes: [synthetic-start]}\n`;
	expect(fixes({ ...twice, 'data/stage.yaml': held, 'dist/legal/index.html': page('<p>Starts soon.</p>') })).toEqual([
		'quote-presence: quote "synthetic-start" is missing: render it with <Quote>; never retype it'
	]);
});

test('a quote on a page the stage does not build needs no slot', () => {
	const elsewhere = syntheticExport({}, [{ id: 'synthetic-start', text: 'Starts on [start date].', pages: ['/elsewhere'], fills: { '[start date]': 'launch.date' } }]);
	expect(fixes({ ...elsewhere, 'data/offer.yaml': '' })).toEqual([]);
});

test('flags a home page over its byte budget and scripts over theirs', () => {
	expect(fixes({ 'dist/_astro/site.css': `body{}/*${'x'.repeat(130 * 1024)}*/`, 'dist/_astro/copy.js': `const copy = "${'y'.repeat(1100)}";` })).toEqual([
		'budget: home page loads 133297 bytes, over the 122880 budget',
		'budget: 1116 bytes of JavaScript, over the 1024 budget'
	]);
});

test('flags a page outside the current stage and a missing page of it', () => {
	expect(fixes({ 'dist/pro/checkout/index.html': page('<p>Synthetic.</p>'), 'dist/.well-known/security.txt': '' })).toEqual(['stage: page outside stage S1']);
	expect(fixes({ 'dist/docs/start/index.html': page('<p>Synthetic.</p>') })).toEqual(['stage: page outside stage S1']);
});

test('without a stage table no page may be built', () => {
	const tree = workspace({ 'dist/_astro/site.css': '' });
	expect(builtFindings(join(tree.directory, 'dist'), tree.directory, [])).toEqual([]);
	tree.remove();
	const paged = workspace({ 'dist/index.html': page('<p>Synthetic.</p>') });
	expect(builtFindings(join(paged.directory, 'dist'), paged.directory, []).map((finding) => finding.fix)).toEqual(['page outside stage none (data/stage.yaml is missing)']);
	paged.remove();
});

test('flags a missing stage page and an emptied stage table', () => {
	expect(fixes({ 'data/stage.yaml': `${stage}  - {path: /company, stages: [S1]}\n` })).toEqual(['stage: /company belongs to stage S1 but was not built']);
	expect(fixes({ 'data/stage.yaml': 'current: S1\nroutes: []\n' }).every((fix) => fix === 'stage: page outside stage S1')).toBe(true);
});

test('flags a local host anywhere in the page', () => {
	expect(fixes({}, ['site.css'])).toContain('local-host: names a production host');
});

test('reads text the way a browser shows it', () => {
	expect(visibleText(page('<p>Mightreya&nbsp;AB &middot; <em>org.</em>\n no.&#160;1&#x2009;2</p><!-- hidden --><style>p{}</style>'))).toBe('Mightreya AB · org. no. 1 2');
});

test('separates blocks the way a browser lays them out, and keeps inline runs together', () => {
	expect(visibleText(page('<p>Write to <a href="mailto:support@strikta.dev">support@strikta.dev</a></p><p>Copyright</p><ul><li>One</li><li>T<strong>wo</strong></li></ul>'))).toBe('Write to support@strikta.dev Copyright One Two');
});

const legalStage = `${stage}  - {path: /legal/trademarks, stages: [S1]}\n`;
const legalFile = '# Synthetic marks\n\nZZZ Mark is a **synthetic** mark.\n\n## 1. Use\n\n- Name `ZZZ` only\n- Never alter it\n\n| Mark | Owner |\n|---|---|\n| ZZZ | Synthetic AB |\n';
const legalPage = (body: string, header?: string): string => page(`<header><p>${header ?? 'Synthetic header'}</p></header><main id="main">${body}</main>`);
const fullLegal = '<h1>Synthetic marks</h1><nav aria-label="Contents"><ol><li><a href="#section-1">1. Use</a></li></ol></nav><p>ZZZ Mark is a <strong>synthetic</strong> mark.</p><section><h2 id="section-1">1. Use</h2><ul><li>Name <code>ZZZ</code> only</li><li>Never alter it</li></ul><table><thead><tr><th>Mark</th><th>Owner</th></tr></thead><tbody><tr><td>ZZZ</td><td>Synthetic AB</td></tr></tbody></table></section>';

function legalFixes(body: string, header?: string): readonly string[] {
	const exported = syntheticExport({ 'legal/trademarks.md': legalFile }, quotes);
	const found = fixes({ ...exported, 'data/stage.yaml': legalStage, 'dist/legal/trademarks/index.html': legalPage(body, header) });
	return found;
}

test('a legal page that shows its whole exported text in order passes', () => {
	expect(legalFixes(fullLegal)).toEqual([]);
});

test('flags a legal page that drops a clause', () => {
	expect(legalFixes(fullLegal.replace('<li>Never alter it</li>', ''))).toEqual(['legal-text: "Never alter it" of legal/trademarks.md is missing or out of order: render it with <Legal>; never retype it']);
});

test('flags a legal page that reorders clauses', () => {
	expect(legalFixes(fullLegal.replace('<li>Name <code>ZZZ</code> only</li><li>Never alter it</li>', '<li>Never alter it</li><li>Name <code>ZZZ</code> only</li>'))).toEqual([
		'legal-text: "Never alter it" of legal/trademarks.md is missing or out of order: render it with <Legal>; never retype it'
	]);
});

test('a heading only in the contents list does not count as shown', () => {
	expect(legalFixes(fullLegal.replace('<h2 id="section-1">1. Use</h2>', ''))).toEqual(['legal-text: "1. Use" of legal/trademarks.md is missing or out of order: render it with <Legal>; never retype it']);
});

test('text outside <main> does not count as shown', () => {
	expect(legalFixes(fullLegal.replace('<li>Never alter it</li>', ''), 'Never alter it')).toEqual([
		'legal-text: "Never alter it" of legal/trademarks.md is missing or out of order: render it with <Legal>; never retype it'
	]);
});

test('flags a legal page whose text is not in the export', () => {
	expect(fixes({ 'data/stage.yaml': legalStage, 'dist/legal/trademarks/index.html': legalPage(fullLegal) })).toEqual([
		'legal-text: no exported file "legal/trademarks.md": a new export is needed'
	]);
});
