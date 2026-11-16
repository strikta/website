import { expect, test } from 'vitest';
import { bandFindings, displayFindings, stylesheetFindings } from './brand.ts';

test('a stylesheet holds tokens only: no literal colour or length, no radius, shadow or angle but the system\'s', () => {
	const text = ['.a{color:#ff0000;margin:3px;transform:translateX(1.5px)}', '.b{border-radius:4px;box-shadow:0 0 2px red}', '.c{border-radius:var(--s-radius);box-shadow:none;transform:rotate(var(--s-angle))}', '.d{transform:skewX(10deg)}'].join('\n');
	const findings = stylesheetFindings({ file: '_astro/zzz.css', text });
	expect(findings.map((finding) => {
		const [excerpt = ''] = finding.fix.split('":');
		return `${String(finding.line)} ${excerpt}`;
	})).toEqual(['1 "#ff0000', '1 "3px', '2 "4px', '2 "2px', '2 "border-radius:4px', '2 "box-shadow:0 0 2px red', '4 "skewX(10deg)']);
});

test('the compiled tokens are the one stylesheet that holds raw values', () => {
	expect(stylesheetFindings({ file: 'token.css', text: ':root{--s-color-ink:#0A0A0A;--s-line-hair:1px}' })).toEqual([]);
});

test('a page has one ink band besides the footer\'s', () => {
	const one = '<section class="hero scheme-dark s-brand-moment"></section><footer class="footer s-brand-moment"></footer>';
	const two = `${one}<section class="s-brand-moment zzz"></section>`;
	expect(bandFindings({ file: 'zzz.html', text: one })).toEqual([]);
	expect(bandFindings({ file: 'zzz.html', text: two })).toHaveLength(1);
});

test('display type is set by the home hero only', () => {
	expect(displayFindings('src/components/Hero.astro', 'font-size: var(--s-text-display);')).toEqual([]);
	expect(displayFindings('src/pages/zzz.astro', 'font-size: var(--s-text-display);')).toHaveLength(1);
	expect(displayFindings('tool/zzz.ts', '--s-text-display')).toEqual([]);
});
