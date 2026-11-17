import type { APIRoute } from 'astro';
import { robotsText } from '../meta.ts';

/** The crawler rules, served as `/robots.txt`. */
export const GET: APIRoute = () => {
	const response = new Response(robotsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
	return response;
};
