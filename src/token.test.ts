import { expect, test } from 'vitest';
import { tokenStyle } from './token.ts';

const style = tokenStyle(process.cwd());

test('the colours become custom properties for both modes, the black brand band and print', () => {
	expect(style).toContain(':root {\n\tcolor-scheme: light dark;\n\t--s-color-paper: #FAFAFA;\n\t--s-color-ink: #0A0A0A;');
	expect(style).toContain('@media (prefers-color-scheme: dark) {\n:root {\n\t--s-color-paper: #0A0A0A;');
	expect(style).toContain('.scheme-dark {\n\tcolor-scheme: dark;\n\t--s-color-paper: #0A0A0A;');
	expect(style).toContain('@media print {\n:root {\n\tcolor-scheme: light;\n\t--s-color-paper: #FAFAFA;');
	expect(style).toContain('--s-color-ink-2: #3D3D3D;');
});

test('type sizes scale between the fluid widths and stay fixed where both ends agree', () => {
	expect(style).toContain('--s-text-xs: 0.75rem;');
	expect(style).toContain('--s-text-base: clamp(1rem, 0.9795rem + 0.0909vw, 1.125rem);');
	expect(style).toContain('--s-text-display: clamp(2.75rem, 1.8909rem + 3.8182vw, 8rem);');
	expect(style).toContain('--s-leading-body: 1.55;');
});

test('space, lines, radius, target, prose width and the column count by width are set', () => {
	expect(style).toContain('--s-space-11: 12rem;');
	expect(style).toContain('--s-line-focus: 2px;');
	expect(style).toContain('--s-radius: 0;');
	expect(style).toContain('--s-target: 44px;');
	expect(style).toContain('--s-prose: 72ch;');
	expect(style).toContain(':root {\n\t--s-columns: 4;\n}');
	expect(style).toContain('@media (min-width: 160rem) {\n:root {\n\t--s-columns: 16;\n}');
});
