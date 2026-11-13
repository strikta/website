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

## Slot and quote access (`src/slot.ts`, `src/quote.ts`, `src/stage.ts`)
`slots` holds every fact of `data/` and of the export's `company.yaml` and `pro.yaml`; `quote(id)` returns an exported quote filled from them; `staged(route)` says whether the current stage builds a page. All three load from `process.cwd()`: builds run from the repository root, and import.meta.url points into the bundle.
```ts
import { quote } from '../quote.ts';
import { slot, slots } from '../slot.ts';
import { staged } from '../stage.ts';

const address = slot(slots, 'company.postal_address'); // an unfilled slot fails the build
const offer = quote('company-licence-offer'); // a missing quote fails the build
const linked = staged('/docs'); // link only to pages the stage builds
```
An exported quote that belongs to a section the current stage does not show is listed under `withheld` in `data/stage.yaml`, so `npm run test:built` does not look for it.

## Legal page
`src/pages/legal/[page].astro` builds one page for each staged entry of `legal` in `src/navigation.ts` under `/legal/`; an entry elsewhere, such as `/withdraw`, has its own page file, like `/security`. Each is rendered by `src/components/Legal.astro` from `exportedText(file)`, which fills the placeholders the export maps to slots. Legal text never goes through Markdown: Markdown would change typography and line joins. `tool/legal.ts` splits the file on its `##` headings and keeps every clause line as it is; only list items (`- `), table rows (`| … |`) and the file's own `**strong**` and `` `code` `` runs become markup, through `Block.astro` and `Clause.astro`, as escaped text; a backslash-escaped mark such as `\*` shows without its backslash.
```astro
---
import Legal from '../../components/Legal.astro';
---
<Legal file="legal/refund-policy.md" draft />
```
A legal text that is not in force is marked `draft: true` in `src/navigation.ts`: its page says "Draft, not in force" and shows the placeholders no slot fills yet exactly as exported, and `npm run test:built` accepts in its `<main>` only the placeholders and price figures that occur as whole matches in that page's own exported text. Any other legal text whose placeholders no slot fills stays out of the stage (`stages: []`) until a new export fills them. Its quotes list its page under `pages` in the export, so `npm run test:built` proves the text arrived.

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
		color: var(--s-color-muted);
		font-style: normal;
	}
	.address a {
		display: inline-block;
		min-block-size: var(--s-target);
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
