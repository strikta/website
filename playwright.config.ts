import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

// Journeys run against the built site in `dist/`, served on this machine only with the live server's Content-Security-Policy, recorded in agent/hosting.md.
export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: true,
	workers: 2,
	forbidOnly: process.env['CI'] !== undefined,
	reporter: 'list',
	use: { baseURL: `http://127.0.0.1:${String(PORT)}` },
	projects: [
		{ name: 'wide', use: { ...devices['Desktop Chrome'] } },
		{ name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 740 } } },
		{ name: 'dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } }
	],
	webServer: {
		command: `node tool/serve.ts ${String(PORT)}`,
		url: `http://127.0.0.1:${String(PORT)}/`,
		reuseExistingServer: false
	}
});
