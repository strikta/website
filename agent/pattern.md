# Patterns: copy the matching one

Each pattern follows AGENTS.md. Where a pattern and AGENTS.md disagree, AGENTS.md wins; fix the pattern in the same PR.

## Quoted text
`src/components/Quote.astro`. Decided wording is never typed into a component: it is looked up by ID.
```astro
---
import { quote } from '../quote.ts';
type Props = { id: string };
const { id } = Astro.props;
const text = quote(id);
---
<span data-quote={id}>{text}</span>
```

## Slot and quote access (`src/quote.ts`)
`loadExport`, `filledText`, `loadSlots` and `slot` exist already; the page-facing `quote()` and the loaded `slots` are added with the first page that needs them.
```ts
// src/slot.ts
// Builds run from the repository root; import.meta.url points into the bundle, so never resolve data from it.
export const slots = loadSlots(join(process.cwd(), 'data'));
```
```ts
// src/quote.ts
import { join } from 'node:path';
import { slots } from './slot.ts';

const exported = loadExport(join(process.cwd(), 'content', 'export'));

export function quote(id: string): string {
	const entry = exported?.quotes.find((candidate) => candidate.id === id);
	if (entry === undefined) {
		throw new Error(`No exported quote "${id}": a new export is needed; never write the text here.`);
	}
	const filled = filledText(entry, slots);
	return filled;
}
```

## Legal page
`src/pages/legal/licence-terms.astro` with `src/components/Legal.astro` and `tool/legal.ts`. Legal text never goes through Markdown: Markdown would change typography and line joins. `legal.ts` splits the exported file on its `##` headings and keeps every clause line as it is; `Legal.astro` renders each line as escaped text.
```ts
// tool/legal.ts
export type Section = { readonly heading: string; readonly lines: readonly string[] };
export type LegalText = { readonly preamble: readonly string[]; readonly sections: readonly Section[] };

export function legalText(text: string): LegalText {
	const [preamble = '', ...parts] = text.split(/^## /mu);
	const sections = parts.map((part) => {
		const [heading = '', ...lines] = part.split('\n');
		const section = { heading, lines: clauses(lines) };
		return section;
	});
	const legal = { preamble: clauses(preamble.split('\n')), sections };
	return legal;
}

function clauses(lines: readonly string[]): readonly string[] {
	const kept = lines.filter((line) => line !== '');
	return kept;
}
```
```astro
---
// src/components/Legal.astro
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalText } from '../../tool/legal.ts';
type Props = { file: string };
const { file } = Astro.props;
const { preamble, sections } = legalText(readFileSync(join(process.cwd(), 'content', 'export', file), 'utf8'));
---
<article class="legal">
	{preamble.map((line) => <p>{line}</p>)}
	{sections.map((part) => (
		<section>
			<h2>{part.heading}</h2>
			{part.lines.map((line) => <p>{line}</p>)}
		</section>
	))}
</article>
```
The page sets the version block from slots and lists the file in `data/stage.yaml`; its quotes list the page under `pages` in the export, so `npm run test:built` proves the text arrived.

## Component
One component per file, single-word PascalCase name, logic in the frontmatter, markup below, colours only from the design tokens, no client script.
```astro
---
// src/components/Address.astro
import { slot, slots } from '../slot.ts';
const address = slot(slots, 'company.postal_address');
---
<address class="address">{address} · <a href="mailto:support@strikta.dev">support@strikta.dev</a></address>
<style>
	.address {
		color: var(--muted);
		font-style: normal;
	}
	.address a {
		display: inline-block;
		min-block-size: 44px;
	}
</style>
```
A section whose slot is not filled yet is hidden by stage in `data/stage.yaml`, never given a default value.

## Service route (Hono, from S3)
Static SQL in module constants, input validated with zod, the clock and the merchant passed in, so a test can fix both.
```ts
// service/cancel.ts
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import * as zod from 'zod';

const INSERT_CANCELLATION = 'INSERT INTO cancellation (identifier, received_at) VALUES (?, ?)';
const cancellationSchema = zod.object({ identifier: zod.string().min(1).max(200) });

export type Clock = () => Date;

export function cancelRoute(database: Database.Database, clock: Clock): Hono {
	const route = new Hono();
	route.post('/cancel', async (context) => {
		const { identifier } = cancellationSchema.parse(await context.req.parseBody());
		const receivedAt = clock().toISOString();
		database.prepare(INSERT_CANCELLATION).run(identifier, receivedAt);
		const received = context.redirect('/cancel/received', 303);
		return received;
	});
	return route;
}
```
```ts
// service/cancel.test.ts
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { cancelRoute } from './cancel.ts';

const SCHEMA = 'CREATE TABLE cancellation (identifier TEXT NOT NULL, received_at TEXT NOT NULL)';
const SELECT_ALL = 'SELECT identifier, received_at AS receivedAt FROM cancellation';

test('a cancellation is stored with the time it was received', async () => {
	const database = new Database(':memory:');
	database.exec(SCHEMA);
	const route = cancelRoute(database, () => new Date('2030-04-10T21:59:59Z'));
	const response = await route.request('/cancel', { method: 'POST', body: new URLSearchParams({ identifier: 'ada@example.com' }) });
	expect(response.status).toBe(303);
	expect(database.prepare(SELECT_ALL).all()).toEqual([{ identifier: 'ada@example.com', receivedAt: '2030-04-10T21:59:59.000Z' }]);
});
```
Time switches are tested the same way: fixed instants on both sides of the boundary, never the wall clock.

## Journey: no third-party request, axe clean
```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the home page stays on its origin and passes axe', async ({ page, baseURL }) => {
	const origin = new URL(baseURL ?? 'http://127.0.0.1:4321').origin;
	const foreign: string[] = [];
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		if (new URL(url).origin === origin) {
			await route.continue();
			return;
		}
		foreign.push(url);
		await route.abort();
	});
	await page.goto('/');
	const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
	expect(foreign).toEqual([]);
	expect(scan.violations).toEqual([]);
	expect(await page.context().cookies()).toEqual([]);
});
```
