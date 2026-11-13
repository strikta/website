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
	'<script src="/_astro/copy.js" type="module"></script><p data-on="x" title="javascript lessons">Fine.</p>',
	'<img src="/font/mark.svg" alt="Strikta"> <img src="https://strikta.dev/mark.svg" alt="">'
])('passes the home page body %j', (body) => {
	expect(fixes({ 'dist/index.html': page(body) })).toEqual([]);
});

test.each([
	['<style>p { color: red; }</style>', '<style>'],
	['<p style="color: red">Red.</p>', '<p style="color: red">'],
	['<p/style="color: red">Red.</p>', '<p/style="color: red">'],
	['<p title="x"style="color: red">Red.</p>', '<p title="x"style="color: red">'],
	['<script>const slots = "{launch.date}";</script>', '<script>'],
	['<script type="module">copy();</script>', '<script type="module">'],
	['<button onclick="copy()">Copy</button>', '<button onclick="copy()">'],
	['<a href="javascript:copy()">Copy</a>', '<a href="javascript:copy()">'],
	['<svg viewBox="0 0 1 1"><style>path{fill:red}</style></svg>', '<style>']
])('flags inline code the CSP blocks: %j', (body, tag) => {
	expect(fixes({ 'dist/index.html': page(body) })).toEqual([`inline: "${tag}": the site's CSP blocks inline style and script; move it to a file`]);
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

const draftStage = `${stage}  - {path: /legal/licence-terms, stages: [S1]}\n`;
const draftLine = 'Until [end date] the price is €99 a year, then €99.';
const draftQuotes = [...quotes, { id: 'synthetic-price', text: draftLine, pages: ['/legal/licence-terms'], fills: { '[end date]': 'founding.end_date' } }];
const draftExport = syntheticExport({ 'legal/licence-terms.md': `# Synthetic terms\n\n${draftLine}\n` }, draftQuotes);
const draftBody = `<h1>Synthetic terms</h1><aside><p><strong>Draft, not in force:</strong> Synthetic.</p></aside><p>${draftLine}</p>`;

function draftFixes(body: string, header?: string): readonly string[] {
	const found = fixes({ ...draftExport, 'data/stage.yaml': draftStage, 'dist/legal/licence-terms/index.html': legalPage(body, header) });
	return found;
}

test('a draft legal page may show the placeholders and price figures of its own exported text', () => {
	expect(draftFixes(draftBody)).toEqual([]);
});

test('a draft legal page must say in its <main> that it is not in force', () => {
	expect(draftFixes(draftBody.replace('<p><strong>Draft, not in force:</strong> Synthetic.</p>', ''))).toEqual([
		'legal-text: a draft legal page says "Draft, not in force" in its <main>: render it with <Legal draft>'
	]);
	expect(draftFixes(draftBody.replace('<p><strong>Draft, not in force:</strong> Synthetic.</p>', ''), 'Draft, not in force')).toEqual([
		'legal-text: a draft legal page says "Draft, not in force" in its <main>: render it with <Legal draft>'
	]);
});

test('a page in force may not show the price figures of its own exported text', () => {
	const privacy = syntheticExport({ 'legal/privacy.md': '# Synthetic notice\n\nFee €99.\n' }, quotes);
	const found = fixes({ ...privacy, 'data/stage.yaml': `${stage}  - {path: /legal/privacy, stages: [S1]}\n`, 'dist/legal/privacy/index.html': legalPage('<h1>Synthetic notice</h1><p>Fee €99.</p>') });
	expect(found).toEqual(['price-figure: "€99.": stage S1 publishes no price figure; hold the section back in data/stage.yaml']);
});

test('flags an exported placeholder of any length that no slot fills, except on its own draft page', () => {
	const long = '[month and year: at least five years after the synthetic release date]';
	const exported = syntheticExport({ 'legal/licence-terms.md': `# Synthetic terms\n\n${draftLine}\n\nSupported until ${long}.\n` }, [
		...draftQuotes,
		{ id: 'synthetic-support', text: `Supported until ${long}.`, pages: ['/legal/licence-terms'], fills: { [long]: 'release.support_end' }, source: { file: 'legal/licence-terms.md' } }
	]);
	const draftPage = legalPage(`${draftBody}<p>Supported until ${long}.</p>`);
	expect(fixes({ ...exported, 'data/stage.yaml': draftStage, 'dist/legal/licence-terms/index.html': draftPage })).toEqual([]);
	expect(fixes({ ...exported, 'data/stage.yaml': draftStage, 'dist/legal/licence-terms/index.html': draftPage, 'dist/index.html': page(`<main><p>Until ${long}.</p></main>`) })).toEqual([
		'placeholder: unfilled slot or placeholder'
	]);
});

test('a draft legal page may not show a placeholder or price figure its exported text does not hold as a whole match', () => {
	expect(draftFixes(`${draftBody}<p>From [renewal day], €120 a year.</p>`)).toEqual([
		'placeholder: unfilled slot or placeholder',
		'price-figure: "€120": stage S1 publishes no price figure; hold the section back in data/stage.yaml'
	]);
	expect(draftFixes(`${draftBody}<p>Or €9 a month.</p>`)).toEqual(['price-figure: "€9": stage S1 publishes no price figure; hold the section back in data/stage.yaml']);
});

test('a draft legal page may not show its own placeholders and price figures outside <main>', () => {
	expect(draftFixes(draftBody, 'Until [end date]: €99.')).toEqual([
		'placeholder: unfilled slot or placeholder',
		'price-figure: "€99.": stage S1 publishes no price figure; hold the section back in data/stage.yaml'
	]);
});

test('no other page may show the placeholders and price figures of a draft legal text', () => {
	const found = fixes({ ...draftExport, 'data/stage.yaml': draftStage, 'dist/legal/licence-terms/index.html': legalPage(draftBody), 'dist/legal/index.html': page('<main><p>Starts on 2030-01-10.</p><p>Until [end date], €99.</p></main>') });
	expect(found).toEqual(['placeholder: unfilled slot or placeholder', 'price-figure: "€99.": stage S1 publishes no price figure; hold the section back in data/stage.yaml']);
});

test('a quote that needs a note passes only with the note after it in the same section', () => {
	const headline = '<h1><span data-quote="home-headline">ZZZ headline.</span></h1>';
	const note = '<p class="qualifier" data-note="hermes" data-astro-cid-zzz>ZZZ note.</p>';
	const flagged = 'note: quote "home-headline" is shown without its "hermes" note after it in the same section';
	expect(fixes({ 'dist/index.html': page(`<main><section>${headline}<p>Lead.</p>${note}</section></main>`) })).toEqual([]);
	expect(fixes({ 'dist/index.html': page(`<main><section>${headline}<p>Lead.</p></section></main>`) })).toEqual([flagged]);
	expect(fixes({ 'dist/index.html': page(`<main><section>${headline}</section><section>${note}</section></main>`) })).toEqual([flagged]);
	expect(fixes({ 'dist/index.html': page(`<main><section>${note}${headline}</section></main>`) })).toEqual([flagged]);
	expect(fixes({ 'dist/index.html': page(`<main><section>${headline}<p data-note="hermes"></p></section></main>`) })).toEqual([flagged]);
});

test('a legal line with escaped marks passes when the page shows the marks without their backslashes', () => {
	const exported = syntheticExport({ 'legal/trademarks.md': '# Synthetic form\n\n- I/We (\\*) withdraw.\n\n(\\*) Delete as appropriate.\n' }, quotes);
	const shown = '<h1>Synthetic form</h1><ul><li>I/We (*) withdraw.</li></ul><p>(*) Delete as appropriate.</p>';
	expect(fixes({ ...exported, 'data/stage.yaml': legalStage, 'dist/legal/trademarks/index.html': legalPage(shown) })).toEqual([]);
	expect(fixes({ ...exported, 'data/stage.yaml': legalStage, 'dist/legal/trademarks/index.html': legalPage(shown.replaceAll('(*)', '(\\*)')) })).toHaveLength(2);
});
