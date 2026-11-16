import { expect, test } from 'vitest';
import { artwork } from '../src/logo.ts';
import { socialPage } from './social.ts';

test('the social preview draws the generated lockup in paper on ink at 64 px cap height, on a 1280 by 640 page', () => {
	const page = socialPage(process.cwd());
	const { shapes } = artwork(process.cwd(), 'lockup');
	expect(shapes.every((shape) => page.includes(`<path d="${shape}"/>`))).toBe(true);
	expect(page).toContain('width:1280px;height:640px;background:#0A0A0A');
	expect(page).toContain('height:64px;fill:#FAFAFA');
	expect(page).toContain('url(data:image/png;base64,');
});
