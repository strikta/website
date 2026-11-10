import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { workspace } from './fixture.ts';
import { POLICY, serve } from './serve.ts';

async function fetched(paths: readonly string[]): Promise<readonly { status: number; policy: string | null; type: string | null; body: string }[]> {
	const tree = workspace({ 'dist/index.html': '<p>Home</p>', 'dist/legal/privacy/index.html': '<p>Privacy</p>', 'dist/_astro/site.css': 'body{}', 'secret.txt': 'outside' });
	const server = serve(join(tree.directory, 'dist'), 0);
	await once(server, 'listening');
	const { port } = server.address() as AddressInfo;
	const responses = await Promise.all(
		paths.map(async (path) => {
			const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
			const answer = { status: response.status, policy: response.headers.get('content-security-policy'), type: response.headers.get('content-type'), body: await response.text() };
			return answer;
		})
	);
	server.close();
	tree.remove();
	return responses;
}

test('serves pages, folders and assets with the live Content-Security-Policy', async () => {
	const [home, privacy, slashed, sheet] = await fetched(['/', '/legal/privacy', '/legal/privacy/', '/_astro/site.css']);
	expect(home).toEqual({ status: 200, policy: POLICY, type: 'text/html; charset=utf-8', body: '<p>Home</p>' });
	expect(privacy?.body).toBe('<p>Privacy</p>');
	expect(slashed?.body).toBe('<p>Privacy</p>');
	expect(sheet?.type).toBe('text/css; charset=utf-8');
});

test('answers 404 with the policy for a missing file and for a path outside the folder', async () => {
	const [missing, outside] = await fetched(['/nowhere', '/%2e%2e/secret.txt']);
	expect(missing).toEqual({ status: 404, policy: POLICY, type: 'text/plain; charset=utf-8', body: 'Not found\n' });
	expect(outside?.status).toBe(404);
});
