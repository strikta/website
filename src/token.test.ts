import { expect, test } from 'vitest';
import { tokenStyle } from './token.ts';

test('the tokens become custom properties for both colour modes and every grid width', () => {
	const style = tokenStyle(process.cwd());
	expect(style).toContain('--accent: #0F766E;');
	expect(style).toContain('@media (prefers-color-scheme: dark) {\n:root {\n\t--bg: #0B0F14;');
	expect(style).toContain('--on-accent: #FFFFFF;');
	expect(style).toContain('--base-size: 17px;\n\t--base-line: 28px;');
	expect(style).toContain('--space-9: 96px;');
	expect(style).toContain('@media (min-width: 1024px) {\n:root {\n\t--cols: 12;\n\t--gutter: 24px;\n}');
	expect(style).toContain('--target: 44px;');
});
