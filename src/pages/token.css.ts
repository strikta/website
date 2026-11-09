import type { APIRoute } from 'astro';
import { tokenStyle } from '../token.ts';

/** The design tokens as CSS custom properties, served as `/token.css`. */
export const GET: APIRoute = () => {
	const response = new Response(tokenStyle(process.cwd()), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
	return response;
};
