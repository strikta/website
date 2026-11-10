import { once } from 'node:events';
import { symlinkSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { workspace } from './fixture.ts';
import { POLICY, serve } from './serve.ts';

type Answer = { status: number; policy: string | null; type: string | null; body: string };

const SITE = { 'dist/index.html': '<p>Home</p>', 'dist/legal/privacy/index.html': '<p>Privacy</p>', 'dist/_astro/site.css': 'body{}', 'secret.txt': 'outside' };

async function fetched(files: Readonly<Record<string, string>>, paths: readonly string[]): Promise<readonly Answer[]> {
	const tree = workspace(files);
	symlinkSync(join(tree.directory, 'secret.txt'), join(tree.directory, 'dist', 'linked.txt'));
	const server = serve(join(tree.directory, 'dist'), 0);
	try {
		await once(server, 'listening');
		const { port } = server.address() as AddressInfo;
		const responses = await Promise.all(paths.map(async (path) => answered(await fetch(`http://127.0.0.1:${String(port)}${path}`))));
		return responses;
	} finally {
		const closed = once(server, 'close');
		server.close();
		await closed;
		tree.remove();
	}
}

async function answered(response: Response): Promise<Answer> {
	const answer = { status: response.status, policy: response.headers.get('content-security-policy'), type: response.headers.get('content-type'), body: await response.text() };
	return answer;
}

test('serves pages, folders and assets with the live Content-Security-Policy', async () => {
	const [home, privacy, slashed, sheet] = await fetched(SITE, ['/', '/legal/privacy', '/legal/privacy/', '/_astro/site.css']);
	expect(home).toEqual({ status: 200, policy: POLICY, type: 'text/html; charset=utf-8', body: '<p>Home</p>' });
	expect(privacy?.body).toBe('<p>Privacy</p>');
	expect(slashed?.body).toBe('<p>Privacy</p>');
	expect(sheet?.type).toBe('text/css; charset=utf-8');
});

test('answers 404 with the policy for a missing file, a path outside the folder, a link out of it and a malformed path', async () => {
	const [missing, ...refused] = await fetched(SITE, ['/nowhere', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/linked.txt', '/%E0%A4%A']);
	expect(missing).toEqual({ status: 404, policy: POLICY, type: 'text/plain; charset=utf-8', body: 'Not found\n' });
	expect(refused.map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404]);
});

test('never serves the sibling page file of the folder itself', async () => {
	const [home] = await fetched({ 'dist/_astro/site.css': 'body{}', 'dist.html': '<p>Sibling</p>', 'secret.txt': 'outside' }, ['/']);
	expect(home?.status).toBe(404);
});
