import { defineConfig } from 'astro/config';

// Static pages only; every stylesheet is a file, so the CSP default-src 'self' needs no inline exception.
export default defineConfig({
	site: 'https://strikta.dev',
	output: 'static',
	trailingSlash: 'ignore',
	build: { format: 'directory', inlineStylesheets: 'never' },
	devToolbar: { enabled: false }
});
