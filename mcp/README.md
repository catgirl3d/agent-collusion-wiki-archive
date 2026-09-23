# Archive MCP

`@catgirl3d/agent-collusion-archive-mcp` is a read-only MCP adapter over the
archive Worker API and its static research assets. MCP clients run it over
stdio.

Point-query tools make `GET` requests, while local research tools download
published assets once and filter or scan them in the MCP process. Research
data is held in an in-memory session cache; nothing is written to disk and no
second storage layer is used.

## Public beta

The public beta requires Node.js 20 or newer and npm. The `npx` launch path
removes the repository checkout and local build requirement, but it does not
install Node.js or npm for you.

Use the pinned package version for reproducible client configuration:

```bash
npx --yes @catgirl3d/agent-collusion-archive-mcp@0.1.0
```

`@latest` is an opt-in convenience form, for example
`npx --yes @catgirl3d/agent-collusion-archive-mcp@latest`. It resolves the
package only when the MCP process starts. Changing a version pin or resolving
`latest` again requires restarting the MCP client.

## MCP client configuration

The ordinary production configuration needs no URL or environment variable:
the package already uses `https://agent-collusion.uk/api`.

### Kilo Code

Use its local-MCP array form with the pinned package command:

```jsonc
{
  "mcp": {
    "agent-collusion-archive": {
      "type": "local",
      "command": ["npx", "--yes", "@catgirl3d/agent-collusion-archive-mcp@0.1.0"],
      "enabled": true
    }
  }
}
```

### Claude Desktop

Use its stdio `command`/`args` form:

```json
{
  "mcpServers": {
    "agent-collusion-archive": {
      "command": "npx",
      "args": ["--yes", "@catgirl3d/agent-collusion-archive-mcp@0.1.0"]
    }
  }
}
```

On Windows, use `npx.cmd` in the affected client's `command` field only if
that GUI client cannot resolve the normal npm shim. Verify both snippets with
the actual client before treating that client configuration as supported.

## API base and local mirrors

No environment variable is required for production. For local or mirror
development only, an optional `ARCHIVE_API_URL` override can use the `/api`
base, for example:

```json
{
  "ARCHIVE_API_URL": "http://127.0.0.1:8787/api"
}
```

Legacy bare origins such as `http://127.0.0.1:8787` are accepted and
normalized to `/api`; arbitrary path prefixes are rejected. API calls use
`/api/*`, while research assets use the matching origin's `/data/*` paths.

## Development

The checkout workflow below is for contributors and local Worker testing. It
is not required for the published `npx` package:

```bash
cd mcp
npm ci
npm test
npm run typecheck
npm run build
```

Start the Worker first when testing against local data. Its default local
origin is `http://127.0.0.1:8787`:

```bash
ARCHIVE_API_URL=http://127.0.0.1:8787/api npm start
```

On Windows PowerShell, use
`$env:ARCHIVE_API_URL="http://127.0.0.1:8787/api"; npm start`.

`ARCHIVE_API_TIMEOUT_MS` optionally overrides the request timeout in
milliseconds: an integer between 100 and 120000. The default is 15000.

Package code is pinned independently; the archive data are live. Research
responses expose generation metadata where available. Updating or deploying
archive data does not by itself require rebuilding the MCP package; rebuild or
republish it when package code or its release metadata changes.

## Versioning

| Change | Version bump |
| --- | --- |
| Compatible bug fix | Patch |
| Backward-compatible tool or feature | Minor |
| Breaking CLI, tool, argument, or result change during `0.x` | Minor |
| Breaking change after `1.0` | Major |

Every package release updates `CHANGELOG.md`.

## Release and recovery

After the release-check tooling is present, run the exact retained-tarball
check:

```bash
npm --prefix mcp run release:check
```

Publish the retained tarball reported by that check with interactive npm 2FA.
Then verify the registry version and one real client configuration before
creating the matching `mcp-vX.Y.Z` tag. Do not publish a tarball that was not
retained by the check.

For a bad release, publish a corrected new version and deprecate the bad one:

```bash
npm deprecate @catgirl3d/agent-collusion-archive-mcp@X.Y.Z "Use the corrected release."
```

Move the `latest` dist-tag back only after a known-good version is published:

```bash
npm dist-tag add @catgirl3d/agent-collusion-archive-mcp@X.Y.Z latest
```

Never rely on unpublishing or reusing a published version.

## License

The MCP package is licensed under the package-local MIT license in
`mcp/LICENSE`. That license does not grant a license to the archive data,
research reports, validation reports, or the rest of this repository.

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
