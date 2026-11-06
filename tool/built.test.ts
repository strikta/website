import { join } from 'node:path';
import { expect, test } from 'vitest';
import { builtFindings, visibleText } from './built.ts';
import { syntheticExport, workspace } from './fixture.ts';
import type { Local } from './local.ts';

const stage = 'current: S1\nroutes:\n  - {path: /, stages: [S1]}\n  - {path: /legal, stages: [S1]}\n  - {path: /pro/checkout, stages: [S3]}\n  - {path: /docs/**, stages: [S2]}\n  - {path: /.well-known/security.txt, stages: [S1]}\n';
const page = (body: string): string => `<!doctype html><html><head><title>Synthetic</title><link rel="stylesheet" href="/_astro/site.css"></head><body>${body}</body></html>`;
const none: Local = { present: false, hosts: [], terms: [] };
const terms = ['Exempelgatan 1', '000000-0000'];
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

function fixes(overrides: Readonly<Record<string, string>>, local?: Partial<Local>): readonly string[] {
	const tree = workspace(site(overrides));
	const found = builtFindings(join(tree.directory, 'dist'), tree.directory, { ...none, ...local }).map((finding) => `${finding.rule}: ${finding.fix}`);
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
	'<p>€99 a year.</p><p>Save your work often.</p>',
	'<a href="https://github.com/strikta/strikta">Source</a> <a href="https://example.com">Example</a>',
	'<p>Write to support@strikta.dev</p>',
	'<script>const slots = "{launch.date}";</script><p>Fine.</p>',
	'<img src="/font/mark.svg" alt="Strikta"> <img src="https://strikta.dev/mark.svg" alt="">'
])('passes the home page body %j', (body) => {
	expect(fixes({ 'dist/index.html': page(body) })).toEqual([]);
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

test('flags a page outside the current stage and a missing page of it', () => {
	expect(fixes({ 'dist/pro/checkout/index.html': page('<p>Synthetic.</p>'), 'dist/.well-known/security.txt': '' })).toEqual(['stage: page outside stage S1']);
	expect(fixes({ 'dist/docs/start/index.html': page('<p>Synthetic.</p>') })).toEqual(['stage: page outside stage S1']);
});

test('without a stage table no page may be built', () => {
	const tree = workspace({ 'dist/_astro/site.css': '' });
	expect(builtFindings(join(tree.directory, 'dist'), tree.directory, none)).toEqual([]);
	tree.remove();
	const paged = workspace({ 'dist/index.html': page('<p>Synthetic.</p>') });
	expect(builtFindings(join(paged.directory, 'dist'), paged.directory, none).map((finding) => finding.fix)).toEqual(['page outside stage none (data/stage.yaml is missing)']);
	paged.remove();
});

test('flags a missing stage page and an emptied stage table', () => {
	expect(fixes({ 'data/stage.yaml': `${stage}  - {path: /company, stages: [S1]}\n` })).toEqual(['stage: /company belongs to stage S1 but was not built']);
	expect(fixes({ 'data/stage.yaml': 'current: S1\nroutes: []\n' }).every((fix) => fix === 'stage: page outside stage S1')).toBe(true);
});

test('flags a local host anywhere in the page', () => {
	expect(fixes({}, { hosts: ['site.css'] })).toContain('local-host: names a production host');
});

test.each([
	['dist/index.html', page('<address>EXEMPELGATAN\n  1</address>')],
	['dist/index.html', page('<p>Exempelgatan <span>1</span></p>')],
	['dist/index.html', page('<p title="000000-0000">Synthetic.</p>')],
	['dist/_astro/site.css', 'body::after { content: "000000-0000"; }'],
	['dist/_astro/copy.js', 'const card = "Exempelgatan 1";'],
	['dist/.well-known/security.txt', 'Contact: mailto:security@strikta.dev\n# Exempelgatan 1\n'],
	['dist/sitemap.xml', '<urlset><url><loc>https://strikta.dev/</loc><!-- Exempelgatan&#32;1 --></url></urlset>'],
	['dist/mark.svg', '<svg><title>Exempel&#173;gatan 1</title></svg>'],
	['dist/site.webmanifest', '{"name": "000000-0000"}'],
	['dist/index.html', page('<noscript><p>Exempel<b>gatan</b> 1</p></noscript>')],
	['dist/index.html', page('<template><p>Exempel<b>gatan</b> 1</p></template>')],
	['dist/index.html', page('<img src="/mark.svg" alt="Exempelgatan&#32;1">')],
	['dist/index.html', page('<a href="/legal" title=\'000000&#x2d;0000\'>Legal</a>')],
	['dist/index.html', page('<p>Exempel&shy;gatan 1</p>')]
])('flags a private term once in %s', (file, content) => {
	expect(fixes({ [file]: content }, { terms }).filter((fix) => fix === 'private-term: names a private term: remove it')).toHaveLength(1);
});

test('flags a second private term that only the visible text joins', () => {
	expect(fixes({ 'dist/index.html': page('<p>000000-0000</p><p>Exempel<b>gatan</b> 1</p>') }, { terms }).filter((fix) => fix.startsWith('private-term'))).toHaveLength(2);
});

test('skips a binary file in the build', () => {
	expect(fixes({ 'dist/font/plex.woff2': 'wOF2\u0000Exempelgatan 1' }, { terms })).toEqual([]);
});

test('passes a page without a private term', () => {
	expect(fixes({ 'dist/index.html': page('<p>Exempelgatan, a synthetic street.</p>') }, { terms })).toEqual([]);
});

test('reads text the way a browser shows it', () => {
	expect(visibleText(page('<p>Mightreya&nbsp;AB &middot; <em>org.</em>\n no.&#160;1&#x2009;2</p><!-- hidden --><style>p{}</style>'))).toBe('Mightreya AB · org. no. 1 2');
});
