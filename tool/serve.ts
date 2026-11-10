import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { root } from './local.ts';

/** The Content-Security-Policy the live server sends with every response. */
export const POLICY = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

const TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.xml': 'application/xml'
};
const BINARY = 'application/octet-stream';
const HOST = '127.0.0.1';

if (import.meta.main) {
	const [port = '4321'] = process.argv.slice(2);
	serve(join(root, 'dist'), Number.parseInt(port, 10));
}

/** Serves a built site from a folder on this machine only, with the live server's Content-Security-Policy on every response. */
export function serve(dist: string, port: number): Server {
	const server = createServer((request, response) => {
		respond(dist, request, response);
	});
	server.listen(port, HOST);
	return server;
}

function respond(dist: string, request: IncomingMessage, response: ServerResponse): void {
	const file = fileOf(dist, new URL(request.url ?? '/', `http://${HOST}`).pathname);
	response.setHeader('Content-Security-Policy', POLICY);
	if (file === undefined) {
		response.writeHead(404, { 'Content-Type': TYPES['.txt'] });
		response.end('Not found\n');
		return;
	}
	response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? BINARY });
	response.end(readFileSync(file));
}

/** The file a request path names inside the built folder: a folder's index.html, a page's .html file, or the file itself; none outside the folder. */
function fileOf(dist: string, pathname: string): string | undefined {
	const base = resolve(dist);
	const target = resolve(base, `.${decodeURIComponent(pathname)}`);
	const candidates = [target, join(target, 'index.html'), `${target}.html`];
	const found = target === base || target.startsWith(`${base}${sep}`) ? candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) : undefined;
	return found;
}
