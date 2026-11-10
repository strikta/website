import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { root } from './local.ts';

/** The Content-Security-Policy the live server sends with every response, as recorded in agent/hosting.md. */
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

/** Serves a built site from a folder on this machine only, with the live server's Content-Security-Policy (agent/hosting.md) on every response. */
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

/** The file a request path names inside the built folder: a folder's index.html, a page's .html file, or the file itself; none outside the folder, through a link or not, and none for a malformed path. */
function fileOf(dist: string, pathname: string): string | undefined {
	const base = realpathSync(dist);
	const decoded = decodedPath(pathname);
	const target = decoded === undefined ? undefined : resolve(base, `.${decoded}`);
	const candidates = target === undefined ? [] : [target, join(target, 'index.html'), `${target}.html`];
	const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile() && inside(base, realpathSync(candidate)));
	return found;
}

/** A request path with its percent-escapes decoded, or undefined when they are malformed. */
function decodedPath(pathname: string): string | undefined {
	try {
		const decoded = decodeURIComponent(pathname);
		return decoded;
	} catch (error) {
		if (error instanceof URIError) {
			return undefined;
		}
		throw error;
	}
}

/** Whether a resolved path lies below a folder. */
function inside(folder: string, path: string): boolean {
	const contained = path.startsWith(`${folder}${sep}`);
	return contained;
}
