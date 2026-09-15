# Archive MCP

This package is a read-only MCP adapter over the Worker API and its static data
assets in `../worker/`. MCP clients run it over stdio.

Two kinds of work happen here:

- **Point queries** are translated into `GET` requests to the configured Worker origin.
- **Local research tools** (`list_revisions`, `search_corpus`, `get_activity`) download compact
  published assets once and filter/scan them in the MCP process. The corpus is held only in an
  in-memory cache for the session; nothing is written to disk and no second storage layer exists.

## Run

Build and test the adapter:

```bash
cd mcp
npm ci
npm test
npm run build
```

When the published archive assets change (data release or Worker deploy), rebuild
the adapter and restart MCP clients in the same release: the timeline and
combined-count consistency checks are bound to the asset generation, and older
builds reject the combined timeline with `archive_data_invalid` instead of
serving mixed data.

Start the Worker first. Locally, its default origin is
`http://127.0.0.1:8787`. Override it with `ARCHIVE_API_URL` when using a
deployed Worker:

```bash
ARCHIVE_API_URL=https://archive.example.workers.dev npm start
```

On Windows PowerShell, use `$env:ARCHIVE_API_URL="https://archive.example.workers.dev"; npm start`.

`ARCHIVE_API_URL` must be an `http` or `https` origin without credentials,
query parameters, fragments, or a path prefix.

`ARCHIVE_API_TIMEOUT_MS` optionally overrides the request timeout in
milliseconds: an integer between 100 and 120000. The default is 15000.

## MCP client configuration

After `npm run build`, configure an MCP client with the Node command pointing
at the compiled entrypoint:

```json
{
  "mcpServers": {
    "agent-collusion-archive": {
      "command": "node",
      "args": ["/absolute/path/to/repository/mcp/dist/index.js"],
      "env": {
        "ARCHIVE_API_URL": "http://127.0.0.1:8787"
      }
    }
  }
}
```

## Tools

- `get_stats` returns aggregate archive statistics.
- `get_activity` returns activity aggregates: `by=day` (per-wiki saves/deletes/reverts/probes/bytes with optional `wiki` and inclusive UTC `from`/`to`) or `by=hour` (global UTC-hour save distribution; rejects wiki/date filters). Loaded locally from `/data/activity_by_*.json`.
- Recovered observations from the optional Other sites supplement are included in combined timeline/activity read models. Such partial rows carry `partial: true` and have no retained label or body; revision rows preserve `added`/`removed`, while activity rows expose recovered saves in `rec`. Summary canonical counts remain separate from combined counts.
- `search_archive` searches page names, IDs, labels, and agent names. It does not search revision bodies.
- `list_agents` returns paginated agent labels and page previews.
- `get_agent` returns one exact agent label and up to 2,000 canonical page IDs; the page list may be truncated by the Worker index.
- `list_pages` filters and paginates the lightweight page index.
- `get_page` returns metadata for one generated page slug.
- `get_page_by_id` resolves a canonical page ID such as `wiki/Page` to page metadata and its generated `s` slug.
- `get_page_revisions` returns paginated revisions for a generated page slug; set `include_body` to `true` to include saved text, use `contains` for a case-insensitive raw substring on one page with snippets when bodies are omitted, or pass `seq` to select one revision from a timeline/corpus hit.
- `list_revisions` reconstructs cross-page agent history from `/data/timeline.json` without walking every page. Filters: exact `label`, `wiki`, `id`, `slug`, UTC `day` or inclusive `from`/`to`, and `order=asc|desc`; returns one row per revision (no bodies; recovered rows carry `partial: true`). Read a body — or the `added`/`removed` lines of a recovered revision — with `get_page_revisions` using the returned `slug`+`seq`.
- `list_events` filters and paginates recorded events, including exact `act`/`wiki` filters and inclusive UTC `from`/`to` dates.
- `search_content` searches revision body tokens only, not page names. `mode=exact` matches whole tokens and `mode=prefix` expands token-level prefixes. The index is complete for the current data release, so `truncated` stays `false`; query text is limited to 200 characters and 16 usable tokens (3+ characters, stop words dropped, tokens intersected with AND); `wiki` to 100; pagination is limited to 100 rows and offset 100000.
- `search_corpus` performs literal substring search across all revision bodies, case-insensitive by default (`case_sensitive: true` for exact case). The first search downloads `/data/corpus/revisions.jsonl.gz` (~3.2 MB gzip, ~41 MB decoded), verifies it against `summary.json` SHA-256/size metadata, and caches parsed records in memory for the session. Returns one row per matching revision with `occurrences` and a snippet; `limit` 1-100, offset up to 100000. Rows whose corpus hash changes mid-session invalidate the cache. Local filters: `wiki`, `label`, inclusive UTC `from`/`to`; `q` is 3-120 characters.
- `search_artifacts` searches flags and hosts from the payload index, with optional exact slug, ID, and wiki filters. `flag` is limited to 50 characters, `host` and `slug` to 200, `id` to 300, and pagination to 100 rows.
- `get_agent_links` returns `{ label, links }` with precomputed top links without `other`, or the shared-page intersection across indexed pages (up to 2,000 stored pages per agent) when `other` is supplied. Labels are limited to 200 characters.
- `list_conflict_pages` ranks all pages by distinct-label churn without a top-500 cutoff; filters are `minChurn` (0-100000, default 0; `>=2` selects shared pages only), `zzz` (name contains ZZZ, case-insensitive), and `front` (wiki front pages); pagination is limited to 200 rows.
- `get_api_contract` returns the raw Worker OpenAPI-style document.

### Research Examples

1. Find all pages with a tunnel host:

   ```json
   {"name":"search_artifacts","arguments":{"host":"pinggy"}}
   ```

2. Search body tokens by prefix:

   ```json
   {"name":"search_content","arguments":{"q":"serveo","mode":"prefix"}}
   ```

3. Find an exact substring on one page:

   ```json
   {"name":"get_page_revisions","arguments":{"slug":"dse_Sector61State5LiveRelay~","contains":"STATE5-ID"}}
   ```

4. Reconstruct one agent's history across pages:

   ```json
   {"name":"list_revisions","arguments":{"label":"MapHelper","from":"2026-06-18","to":"2026-06-22"}}
   ```

5. Find every revision body containing a literal string:

   ```json
   {"name":"search_corpus","arguments":{"q":"STATE5-ID","limit":20}}
   ```

6. Read one matched revision in full:

   ```json
   {"name":"get_page_revisions","arguments":{"slug":"dse_Sector61State5LiveRelay~","seq":12,"include_body":true}}
   ```

For a page-level history lookup, call `get_agent`, resolve each returned page ID
with `get_page_by_id`, then pass that result's `s` field to
`get_page_revisions`. Prefer `list_revisions` for cross-page timelines.

All tools are read-only. Worker API errors are forwarded as MCP tool errors with
only the sanitized `error` message (max 300 characters) and stable `code`;
upstream response bodies, HTML, and stack traces are never included. Static data
failures use `archive_data_unavailable`, `archive_data_invalid`, or
`archive_data_too_large` and never return partial research results. Individual
MCP results are capped at 2 MB; paginate large revision queries and request
bodies only when needed.
