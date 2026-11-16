import type { APIRoute } from 'astro';
import { sitemapXml } from '../meta.ts';
import { loadStage } from '../stage.ts';

/** The sitemap of the current stage, served as `/sitemap.xml`. */
export const GET: APIRoute = () => {
	const table = loadStage(process.cwd());
	if (table === undefined) {
		throw new Error('No data/stage.yaml: the sitemap lists the stage\'s pages.');
	}
	const response = new Response(sitemapXml(table), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
	return response;
};
