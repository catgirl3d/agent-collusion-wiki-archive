# Archive MCP

This package is a read-only MCP adapter over the Worker API in `../worker/`.
It does not contain archive data and does not implement a second filtering or
storage layer. MCP clients run it over stdio; the adapter translates tool calls
into `GET` requests to the configured Worker origin.

## Run

Build and test the adapter:

```bash
cd mcp
npm ci
npm test
npm run build
```

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
- `search_archive` searches page names, IDs, labels, and agent names. It does not search revision bodies.
- `list_agents` returns paginated agent labels and page previews.
- `get_agent` returns one exact agent label and up to 2,000 canonical page IDs; the page list may be truncated by the Worker index.
- `list_pages` filters and paginates the lightweight page index.
- `get_page` returns metadata for one generated page slug.
- `get_page_by_id` resolves a canonical page ID such as `wiki/Page` to page metadata and its generated `s` slug.
- `get_page_revisions` returns paginated revisions for a generated page slug; set `include_body` to `true` to include saved text, or use `contains` for a case-insensitive raw substring on one page with snippets when bodies are omitted.
- `list_events` filters and paginates recorded events, including exact `act` and `wiki` filters.
- `search_content` searches revision body tokens only, not page names. `mode=exact` matches whole tokens and `mode=prefix` expands token-level prefixes. Postings are adaptively capped, so `truncated=true` means results may be incomplete; results are sorted by revision count descending. Use `get_page_revisions` with `contains` for an exact substring within one page. Query text is limited to 200 characters and 16 usable tokens; `wiki` to 100; pagination is limited to 100 rows and offset 100000.
- `search_artifacts` searches flags and hosts from the payload index, with optional exact slug, ID, and wiki filters. `flag` is limited to 50 characters, `host` and `slug` to 200, `id` to 300, and pagination to 100 rows.
- `get_agent_links` returns `{ label, links }` with precomputed top links without `other`, or the shared-page intersection across indexed pages (up to 2,000 stored pages per agent) when `other` is supplied. Labels are limited to 200 characters.
- `list_conflict_pages` filters the full conflict list without a top-500 cutoff; `minChurn` is 0-100000, and pagination is limited to 200 rows.
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

For an agent history lookup, call `get_agent`, resolve each returned page ID
with `get_page_by_id`, then pass that result's `s` field to
`get_page_revisions`.

All tools are read-only. API errors are returned as MCP tool errors without
forwarding upstream response bodies or stack traces. Individual MCP results
are capped at 2 MB; paginate large revision queries and request bodies only
when needed.
