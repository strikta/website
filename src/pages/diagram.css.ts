import type { APIRoute } from 'astro';
import { diagramStyles } from '../diagram.ts';

/** The diagram sizes from `data/`, served as `/diagram.css`, so no page needs an inline style. */
export const GET: APIRoute = () => {
	const response = new Response(diagramStyles(process.cwd()), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
	return response;
};
