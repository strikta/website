import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Artwork = { readonly viewBox: string; readonly shapes: readonly string[] };
/** The mark's two blocks, left and right of the cut. */
export type Blocks = { readonly left: string; readonly right: string };

const VIEW_BOX = /\bviewBox="(?<viewBox>[^"]+)"/u;
const PATH = /<path\b[^>]*\bd="(?<path>[^"]+)"/u;
const SHAPE = /M[^Z]*Z/gu;

/**
 * The view box and the closed shapes of a logo file in `public/brand/`, such as `lockup` or `mark`, so a page draws the
 * generated artwork inline in the current text colour; the mark's two shapes are the blocks either side of the cut.
 */
export function artwork(root: string, name: string): Artwork {
	const file = join(root, 'public', 'brand', `${name}.svg`);
	const svg = readFileSync(file, 'utf8');
	const viewBox = VIEW_BOX.exec(svg)?.groups?.['viewBox'];
	const path = PATH.exec(svg)?.groups?.['path'];
	if (viewBox === undefined || path === undefined) {
		throw new Error(`${file} has no view box or no path: copy it again from the brand generator's output.`);
	}
	const art = { viewBox, shapes: path.match(SHAPE) ?? [] };
	return art;
}

/** The mark's two blocks either side of the cut, taken from `public/brand/mark.svg` so its geometry is never retyped. */
export function markBlocks(root: string): Blocks {
	const { shapes } = artwork(root, 'mark');
	const [left, right, ...rest] = shapes;
	if (left === undefined || right === undefined || rest.length > 0) {
		throw new Error('public/brand/mark.svg is not two blocks: copy it again from the brand generator\'s output.');
	}
	const blocks = { left, right };
	return blocks;
}
