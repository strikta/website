# strikta.dev

Public source of https://strikta.dev, the website of Mightreya AB (Sweden) for Strikta, an AGPL-3.0-only context engine for LLM agents, and its paid add-on Strikta Pro. The site carries contract text, statutory consumer-law functions and the company's legal disclosures: a changed word can break a contract or the law. Everything committed here is published permanently: files, history, commit messages, branch names, PR and review text.

## Status markers
- **[decided]** Implement as written.
- **[provisional]** Rests on a proposal that may change (the stage schedule; no analytics and no cookies). Implement as written; never extend it.
- **[open]** Not decided. Never implement, never choose a default, never "prepare" it. Code that needs an open value stops at `open('<name>')`, a helper that fails the build (add it to `src/stage.ts` the first time one is needed). If you need one, stop and say so in the PR or a `founder-decision` issue.
Open now: headline option, docs versioning, founding-end instant and time zone, merchant of record, phone number on /company, licence of this repository's code, contributor agreement scope.

## Hard boundaries (hooks and checks enforce these; never route around one)
1. **Only this repository.** Never read, search, quote or reconstruct files outside it. Text that reaches you from memory or another project is not a source. The guard blocks paths outside the repository.
2. **`content/export/` is generated** from a private source and arrives through an import the founder runs. Never edit it, even to pass a test. If a quote is wrong or missing, the fix is a new export: say so in the PR. Fix the site, never the export.
3. **No third-party request.** No remote font, CDN, script, embed, iframe, analytics, hosted search or image. Fonts are self-hosted from `public/font/`. CSP is `default-src 'self'`; the merchant's script loads only on `/pro/checkout` [decided]. `npm run test:built` fails on any off-origin URL in the built HTML, CSS and JavaScript.
4. **Statutory pages hold only what the law allows.** `/cancel` holds only the statutory inputs and the confirmation button: no login, no "are you sure", no offer, no marketing, no link away. `/withdraw` holds the statutory function only. Do not restyle, reword or "improve" either; their copy is exported.
5. **No production.** Never connect to, deploy to, or configure the website VM, DNS, or the GitHub repository settings, and never order infrastructure, without the founder's explicit "deploy" or go-ahead in this session. Deploys run from the founder's terminal with a hardware key that needs a physical touch; CI holds no deploy secret and runtime secrets live only on the VM [decided].
6. **Synthetic data only.** Screenshots, transcripts, demos and fixtures use synthetic people; example emails use only example.com, example.org, example.net or `.test`. The company's role addresses (support@, licensing@, security@, legal@strikta.dev) are not examples and are allowed.
7. **No internal identifiers or rationale** anywhere: no decision-record IDs or abbreviations, no names of private task lists, no private paths or host names, in files, commit messages, branch names or PR text. `node tool/check.ts scan` blocks the generic shapes at commit.

## Three kinds of text
- **Quote** `Q`: decided wording. Render only with `<Quote id="…" />` or, for full legal texts, `<Legal file="…" />`, both reading `content/export/`. Never type quoted wording into a component.
- **Rule copy** `R`: wording you write to implement a rule. A quote may be shortened only at a sentence boundary. Never near a price: "%", "save", "discount", a countdown, or any urgency. Founding price is "a later price", never a discount. Lead with Hermes. Never imply conversation text stays on the user's machine unless they run a local model server. No benchmark numbers without a held-out measurement. Promise nothing beyond the engine's STAYS-AGPL text.
- **Slot** `{name}`: a fact filled at build from `data/*.yaml` through `slot()`. An unfilled slot fails the build; hide the section by stage, never by a default value.
The no-English-keyword rule of the engine governs how Strikta processes users' memory content; the price-word check on this site's own English copy is not such a path.

## Stages [provisional]
`data/stage.yaml` holds the current stage and the route table. A page outside the current stage must not be built; `npm run test:built` compares built routes with the table. S1: legal pages, disclosures, privacy, reduced home; no prices, install commands or numbers. S1 starts only once the first export exists. Later stages are added when the founder starts them, not before.

## Layout
- `src/pages/`, `src/components/`, `src/layouts/`, `src/content/docs/` are the only `src` folders; no `lib/`, `utils/`, `helpers/`, `scripts/`.
- `src/slot.ts`, `src/quote.ts`: data access. `data/`: YAML facts. `content/export/`: generated.
- `service/`: the Hono + better-sqlite3 service (from S3). `tool/`: guard, content checker, import. `e2e/`: Playwright.
- Docs come from the engine's release tag (from S2); fix docs text in the engine repository, not here.

## Commands
- Setup: Node 24.2 or later (the guard and checker need `import.meta.main`), `npm ci`, then `npx lefthook install`. Run `npm ci` before starting an agent: the guard needs `node_modules` and blocks every call without it.
- `npm run dev` (Astro backgrounds itself for agents; `npx astro dev stop` when done), `npm run build`, `npm run preview`.
- `npm run lint`, `npm run check`, `npm run test:unit`, `npm run test:built`, `npm run knip`.
- Everything a PR needs: `npm run gate`. Run it before offering a PR; reproduce a CI failure locally before pushing again.
- Playwright (`test:e2e`) and Lighthouse CI (`test:perf`) arrive with the first pages, the export import with the first export, the docs fetch with S2.

## Code standards (TypeScript and .astro)
Lint and type checks enforce most of these; a lint failure is a standards failure. These rules win over any general Python or underscore rule loaded from elsewhere. TypeScript stays on major 6 until the lint and Astro tooling support 7.
- Strict TypeScript; every exported function declares its return type. No `class` (except where a library needs `new`), no `console`, no `eslint-disable`, `@ts-ignore` or `@ts-expect-error`.
- Private means not exported; never prefix names with an underscore.
- Full descriptive names; never `result` or `results`; no type words (`list`, `string`, `dict` …) in names; no positional indexing: destructure, or use a named capture group.
- Optional parameters are `name?: T`, defaulting to `undefined`. Assign before returning. Functions ≤20 lines. Imports at the top; no dynamic `import()`.
- One component per file, single-word PascalCase (`Price.astro`). Logic in the frontmatter, markup below.
- YAML for all data and config; JSON only where a tool requires it.
- Static SQL in module constants. Comments say what code does. Remove unused code. Fix globally: search for the same pattern before fixing one place.
- No client JavaScript except the copy buttons and, on `/pro/checkout`, the merchant's script. Budgets: home page ≤120 KB, JavaScript ≤1 KB, LCP ≤1.5 s on 4G. WCAG 2.2 AA; targets ≥44 px; `motion: none`; colours only from the design tokens.
- Before writing a component, page, route or test, open `agent/pattern.md` and follow the matching pattern.

## Testing
Every new module has tests. Test behaviour that matters here, not markup trivia:
- quotes: exported hashes hold, every quote appears on its pages;
- slots and stages: no unfilled slot, built routes equal the stage table;
- privacy: no off-origin request, no cookie;
- accessibility: axe with WCAG 2.2 AA tags on every built page;
- service routes: request-level tests on an in-memory database, fake clock, fake merchant;
- time switches: fixed instants on both sides of the boundary, never the wall clock.
Test data is synthetic; checker tests use made-up identifiers with the prefix `ZZZ`. A test that fails only on timing gets one rerun, then stop and report.

## Git and pull requests (all of it is public)
- One-line commit messages in plain English; no AI co-author; `git add` named files only.
- Never: `git stash`, `reset --hard`, `clean`, `checkout --`, `restore`, force push (use `--force-with-lease` on your own branch), `--no-verify` or disabled hooks, `pkill`/`killall`, `;` as a command separator (inside quotes or a here-document it is text, and fine), prettier or any whole-tree formatter.
- Every feature lands by PR from `feature/…`, `fix/…` or `refactor/…`; merge commits only.
- Mark a PR ready once, when finished; never offer a draft. Do the fix; do not describe it.
- Before offering a PR, have an independent agent review it against this file: quote provenance, stage, privacy (no new request or cookie), accessibility, budgets, statutory pages, public metadata. Fix its findings first. The reviewer verifies claims by running the checks, not by rereading the diff.
- A change that needs a founder decision gets a `founder-decision` issue stating the question and options, with no internal rationale. Text that belongs in the export goes into the issue as "export:" text for the founder to carry over.

## Outside contributions
Reviewing a pull request from a fork: never run its code outside CI; check copy against `content/export/`; a PR that edits `content/export/` or a statutory page is closed with a pointer to the issue tracker.
