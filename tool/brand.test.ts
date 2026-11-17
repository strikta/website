import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { brandFindings, bandFindings, displayFindings, stylesheetFindings } from './brand.ts';
import { workspace } from './fixture.ts';

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
	expect(displayFindings('src/zzz.test.ts', "expect(style).toContain('--s-text-display: 1rem;');")).toEqual([]);
});

test('the social preview is checked for its size and the brand palette: ink, grain and paper, nothing coloured', () => {
	const tokens = readFileSync(join(process.cwd(), 'data', 'tokens.yaml'), 'utf8');
	const real = workspace({ 'data/tokens.yaml': tokens, 'dist/index.html': '<main></main>' });
	const coloured = workspace({ 'data/tokens.yaml': tokens, 'dist/index.html': '<main></main>' });
	const social = readFileSync(join(process.cwd(), 'public', 'brand', 'social.png'));
	writeImage(real.directory, social);
	writeImage(coloured.directory, solidPng(1280, 640, [200, 16, 46]));
	expect(brandFindings(join(real.directory, 'dist'), real.directory)).toEqual([]);
	expect(brandFindings(join(coloured.directory, 'dist'), coloured.directory).map(({ fix }) => fix)).toEqual(['the social preview holds a colour: it is ink, grain and paper only']);
	real.remove();
	coloured.remove();
});

function writeImage(directory: string, image: Buffer): void {
	mkdirSync(join(directory, 'dist', 'brand'), { recursive: true });
	writeFileSync(join(directory, 'dist', 'brand', 'social.png'), image);
}

/** A one-colour 8-bit RGB PNG, every row unfiltered. */
function solidPng(width: number, height: number, colour: readonly number[]): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => colour).flat())]);
	const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
	const image = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
	return image;
}

/** A PNG chunk; the check does not read the checksum, so it is left zero. */
function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const framed = Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
	return framed;
}
