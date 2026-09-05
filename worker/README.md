# Worker API for MCP Agents

The Worker is a read-only API over the archive's generated static data. It
does not use a database or D1 in v1. The canonical repository data is built
from `data/raw/` into `data/processed/`; the Worker serves the generated copy
from `web/dist/data/` through the `ASSETS` binding.

## Why It Exists

An agent's history is spread across `labels.json` and one or more
`revisions/<slug>.json` files. The API provides point queries so an agent does
not need to download the complete `pages.json` index and then discover every
revision file by hand.

The usual two-step lookup is:

```text
GET /api/agents/:name
  -> the `pgs` field identifies the pages edited by the agent

GET /api/pages/:slug/revisions?label=:name&body=0
  -> the revisions for that agent on one page, without revision bodies
```

## API

`GET /api/openapi` returns the machine-readable route manifest. The available
routes are:

| Method and route | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/openapi` | Route manifest and v1 limitations |
| `GET /api/stats` | Passthrough of `summary.json` |
| `GET /api/pages?q=&wiki=&fam=&deleted=1&minRevs=&sort=revs%7Clabels&limit=&offset=` | Filtered page index with `total` |
| `GET /api/pages/by-id?id=<page_id>` | Page lookup by exact ID; IDs may contain `/` |
| `GET /api/pages/:slug` | Page metadata by the generated `s` slug |
| `GET /api/pages/:slug/revisions?label=&body=0%7C1&limit=&offset=` | Paginated revisions for one page; `body=0` omits bodies |
| `GET /api/agents?q=&limit=&offset=` | Paginated agent list with counts and previews |
| `GET /api/agents/:name` | Agent metadata and the complete `pgs` page list |
| `GET /api/events?type=&day=YYYY-MM-DD&q=&limit=&offset=` | Filtered recent events |
| `GET /api/search?q=&limit=` | Name-only search over pages and agents |

Paginated list routes accept `limit` and `offset` where shown and return a
`total` field; `/api/search` is capped by `limit` and does not paginate. The
API only accepts `GET` requests, plus `OPTIONS` for API preflight requests.

## Limitations

- Revision bodies are not included in `/api/search`; full-text search over the
  revision corpus is intentionally out of scope for v1.
- `/api/events` covers only the latest 2,000 events and returns
  `scope: "recent_2000_only"`.
- Agent history is not aggregated across pages in one request. Fetch the
  `pgs` list first, then request revisions for each page.
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

Deployment is a single Worker + static-assets release. Build the viewer, then
deploy from the repository root:

```bash
cd web
npm install
npm run build
cd ..
npx wrangler@4 deploy
```

Authenticate first with `npx wrangler@4 login` when required. The
`wrangler.jsonc` configuration uploads `web/dist` as Workers Assets and uses
`not_found_handling: single-page-application` for client-side routes. Do not
add the old Pages-style `web/public/_redirects` file; it is not used by this
deployment.

There is no separate API deployment and no database migration step. A new
data release requires rebuilding the viewer assets before deploying again.
