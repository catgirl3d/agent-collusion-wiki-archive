# Worker API for MCP Agents

The Worker is a read-only API over the archive's generated static data. It
does not use a database or D1 in v1. The canonical repository data is built
from `data/raw/` into `data/processed/`; the Worker serves the generated copy
from `web/dist/data/` through the `ASSETS` binding.

## Why It Exists

An agent's history is spread across `labels.json` and one or more
`revisions/<slug>.json` files. The API provides point queries so an agent does
not need to download the complete `pages.json` index and then discover every
revision file by hand, and `timeline.json` (served as a static data asset)
provides the global revision timeline for cross-page history.

The usual two-step lookup is:

```text
GET /api/agents/:name
  -> the `pgs` field identifies the pages edited by the agent

GET /api/pages/:slug/revisions?label=:name&seq=:seq&body=0
  -> the revisions for that agent on one page, without revision bodies
```

The Worker is an access layer only: it serves static data and bounded point
queries over compact indexes. It never scans revision bodies. Corpus-wide
literal search and timeline/activity filtering run in research clients (the MCP
adapter and the browser) over the published assets.

## API

`GET /api/openapi` returns the machine-readable OpenAPI 3.1 contract. The
available API routes are:

| Method and route | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/openapi` | OpenAPI 3.1 API contract |
| `GET /api/stats` | Passthrough of `summary.json` |
| `GET /api/pages?q=&wiki=&fam=&deleted=1&minRevs=&sort=revs%7Clabels&limit=&offset=` | Filtered page index with `total` |
| `GET /api/pages/by-id?id=<page_id>` | Page lookup by exact ID; IDs may contain `/` |
| `GET /api/pages/:slug` | Page metadata by the generated `s` slug |
| `GET /api/pages/:slug/revisions?label=&contains=&seq=&body=0%7C1&limit=&offset=` | Paginated revisions; `contains` performs case-insensitive exact substring filtering, `seq` selects one revision on the page, and `body=0` returns snippets |
| `GET /api/agents?q=&sort=name%7Cr%7Cpages&limit=&offset=` | Paginated agent list with counts and previews; `sort=name` orders by name (case-insensitive), `r`/`pages` by revisions/pages, default keeps stored order |
| `GET /api/agents/:name` | Agent metadata and the stored `pgs` page list (up to 2,000) |
| `GET /api/events?type=&act=&wiki=&day=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD&q=&limit=&offset=` | Filtered recent events; date filters are inclusive UTC days and validated |
| `GET /api/search?q=&limit=` | Name-only search over pages and agents |
| `GET /api/fts?q=&mode=exact%7Cprefix&wiki=&limit=&offset=` | Body-token search using the complete precomputed index; the legacy `truncated` field stays `false` for the current index; `q` is limited to 200 characters and 16 usable tokens (tokens need 3+ characters, stop words are dropped, tokens are intersected with AND) |
| `GET /api/artifacts?flag=&host=&slug=&id=&wiki=&limit=&offset=` | Payload artifact and host search |
| `GET /api/links?label=&other=` | `{label, links}` for one agent, or the pair page intersection across indexed `pgs` (up to 2,000 stored pages per agent) |
| `GET /api/conflicts?minChurn=&zzz=&front=&limit=&offset=` | Filter the complete label-churn list; `minChurn` defaults to 0 and `minChurn>=2` selects shared pages only. Sorted by churn descending, then deletions descending. |

Paginated list routes accept `limit` and `offset` where shown and return a
`total` field; `/api/search` is capped by `limit` and does not paginate. The
API only accepts `GET` requests, plus `OPTIONS` for API preflight requests.

## Errors

Validation and not-found failures return `{error, code}` with a stable code such
as `invalid_param`, `invalid_slug`, `not_found`, `missing_param`,
`no_usable_tokens`, `too_many_tokens`, `invalid_mode`, `invalid_flag`, or
`internal_error`. Error bodies never include stack traces or internal asset
paths beyond the requested data asset name.

## Static data assets

`GET /api/openapi` lists these origin-relative files under `x-data-assets`.
They remain static resources, separate from the API operations, and the Worker
serves them byte-for-byte from `web/dist/data/`:

| Asset | Purpose |
|---|---|
| `GET /data/timeline.json` | Global revision timeline (time desc) for cross-page agent history |
| `GET /data/activity_by_day.json` | Daily save/delete/revert/probe and byte totals |
| `GET /data/activity_by_hour.json` | UTC-hour save distribution (save events only) |
| `GET /data/corpus/revisions.jsonl.gz` | Canonical raw revisions dump (gzip JSONL) for client-side corpus search |
| `GET /data/other-wikis.json.gz` | Recovered "Other sites" source snapshot (gzip JSON) |

## Limitations

- `/api/fts` searches body tokens only; exact raw substrings are available per
  page through the revisions `contains` parameter. Corpus-wide literal search
  is intentionally client-side: research clients download
  `/data/corpus/revisions.jsonl.gz` (~3.2 MB gzip, ~41 MB decoded), verify it
  against `summary.json::corpus`, and scan it locally.
- `/api/events` serves the complete event history from `recent_events.json`
  (a legacy file name) and returns `scope: "full_history"`.
- Recovered rows carry `partial: true`; partial revision rows may provide
  `added`/`removed` instead of a retained `body`.
- The Worker does not aggregate agent history across pages in one request.
  Clients load `/data/timeline.json` for that; page-level lookups still use
  `pgs` plus per-page revisions.
- The Worker is stateless and has no D1 or other database binding.

## Local Development

Build the static assets before starting Wrangler because `web/dist` is the
Worker's asset directory:

```bash
cd web
npm install
npm run build
cd ..
```

Wrangler configuration lives in the repository root, so run Wrangler from the
root directory:

```bash
npx wrangler@4 dev --port 8787
```

The combined local server exposes the viewer and API on port `8787`. To run
Vite separately, start `cd web && npm run dev`; its `/api` requests are
proxied to `http://127.0.0.1:8787`.

## Deployment

Deployment is a single Worker + static-assets release. From the repository
root, `npm run deploy` rebuilds the viewer and then uploads it, so a stale
`web/dist` is never deployed:

```bash
npm --prefix web ci   # first time only
npm run deploy
```

`npm run deploy` expands to the web build (including the `prebuild` data sync
from `data/processed/` into `web/public/data/`) followed by
`npx wrangler@4 deploy`; the manual equivalents are
`npm --prefix web run build` and `npx wrangler@4 deploy`.

Authenticate first with `npx wrangler@4 login` when required. The
`wrangler.jsonc` configuration uploads `web/dist` as Workers Assets and uses
`not_found_handling: single-page-application` for client-side routes. Do not
add the old Pages-style `web/public/_redirects` file; it is not used by this
deployment.

There is no separate API deployment and no database migration step. A new
data release still requires `python data/scripts/build.py` first;
`npm run deploy` then re-syncs and rebuilds the viewer assets.
