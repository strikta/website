import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { parse } from 'yaml';
import * as zod from 'zod';
import { artwork } from '../src/logo.ts';
import { root } from './local.ts';

/** The social preview: 1280 × 640, ink with grain, the lockup at 64 px cap height (the lockup is 24 units tall, all cap height). */
const SIZE = { width: 1280, height: 640 };
const CAP_HEIGHT = 64;
const OUTPUT = join('public', 'brand', 'social.png');
const tokenSchema = zod.object({ color: zod.object({ light: zod.object({ ink: zod.string(), paper: zod.string() }) }), grain: zod.object({ opacity: zod.number(), tile: zod.string() }) });

if (import.meta.main) {
	await render(root);
}

/** The preview as one self-contained HTML page: the brand's ink and paper, its grain tile and the lockup from `public/brand/`. */
export function socialPage(directory: string): string {
	const tokens = tokenSchema.parse(parse(readFileSync(join(directory, 'data', 'tokens.yaml'), 'utf8')));
	const { ink, paper } = tokens.color.light;
	const grain = readFileSync(join(directory, 'public', tokens.grain.tile)).toString('base64');
	const { viewBox, shapes } = artwork(directory, 'lockup');
	const paths = shapes.map((shape) => `<path d="${shape}"/>`).join('');
	const style = [
		`html,body{margin:0;width:${String(SIZE.width)}px;height:${String(SIZE.height)}px;background:${ink}}`,
		`body{position:relative;display:grid;place-items:center}`,
		`body::before{position:absolute;inset:0;content:"";background:url(data:image/png;base64,${grain});opacity:${String(tokens.grain.opacity)}}`,
		`svg{position:relative;height:${String(CAP_HEIGHT)}px;fill:${paper}}`
	].join('');
	const page = `<!doctype html><html><head><style>${style}</style></head><body><svg viewBox="${viewBox}">${paths}</svg></body></html>`;
	return page;
}

/** Screenshots the preview into `public/brand/social.png`. */
async function render(directory: string): Promise<void> {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
	await page.setContent(socialPage(directory));
	writeFileSync(join(directory, OUTPUT), await page.screenshot({ type: 'png' }));
	await browser.close();
}
