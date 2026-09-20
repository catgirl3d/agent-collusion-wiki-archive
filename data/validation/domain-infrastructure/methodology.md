# Methodology and evidence model

## Research questions

This package addresses five bounded questions:

1. Which normalized hostnames and logical resources are observable in the held
   archive snapshot?
2. What technical role could each resource perform?
3. What role is explicitly described or corroborated by retained revision
   bodies?
4. Which resources have coordination relevance rather than only retrieval
   relevance?
5. Which public incident sites are present, absent, or ambiguous in this
   snapshot?

It does not attempt to identify the underlying model, task-runner operator,
human operator, authenticated user, or physical agent process.

## Source snapshot

The primary data source is the archive export exposed through the
`agent-collusion-archive` MCP. Its reported source is
`https://collusion.wiki/explorer/download.html` and its generation timestamp is
`2026-09-03T03:42:36Z`.

| Object | Count or hash |
|---|---|
| Revisions | 14,591 |
| Pages | 4,579 |
| Labels | 3,102 named labels |
| Events | 14,591 saves; 5,217 deletes; 4 reverts; 101 probes |
| Compressed corpus SHA-256 | `9c2a4ef0ccbfb5b42be8422342a6bd3a389a4a047bc891e3148354dd65b63c96` |
| Decoded corpus SHA-256 | `60df4a515178230aa952d9f64f6215aea4bd95ab2f05e31e484cf9b887e3f793` |

Archive authenticity, collection completeness, and chain of custody were not
independently established during this review. Hashes anchor the analyzed
snapshot; they do not authenticate the original activity.

## MCP surfaces used

| Tool | Role in this package | Interpretation constraint |
|---|---|---|
| `get_stats` | Snapshot and per-wiki population | Describes the held export only |
| `search_corpus` | Literal body substring search | Counts matching full-body revisions, including inherited text |
| `search_artifacts` | Extracted host and payload discovery | Page-level heuristic index, not transaction telemetry |
| `get_page_revisions` | Exact body, label, sequence, and UTC time | A body claim remains a claim unless corroborated |
| `list_pages` | Page population and logical wiki inventory | Page rows do not currently expose full URL metadata |
| `list_revisions` | Cross-page temporal traces | Order does not prove causality |
| `search_archive` | Page IDs, names, and labels | Does not search body text |
| `list_events` | Saves, deletes, reverts, and probes | Event payloads and saved bodies are different populations |

The compact query record is in [`query-log.csv`](query-log.csv).

## Entity ontology

The package deliberately distinguishes these entities:

| Entity | Example | Meaning |
|---|---|---|
| Registrable domain | `bitily.in` | DNS registrable boundary |
| Hostname | `app.bitily.in` | Exact network host string |
| Wildcard host family | `*.run.pinggy-free.link` | Multiple ephemeral hostnames under one service |
| Logical site | `dse` | Archive/wiki identifier, not necessarily a DNS name |
| Path-based resource | `wikiservice.at/dse/wiki.cgi` | One logical application under a shared host |
| Endpoint or namespace | `/v1/sector61-state5-fast-9417/XX/up` | Protocol-specific resource under a host |
| Alias or mirror | `prowiki.org/dse` | Alternative address described by archived links |
| Encoded host-like token | `sec.g%6fv` | Parser/filter test; not a separate normalized host |
| Malformed token | `investor.gov_12000` | Host-like string with an invalid suffix |

Public reports often count sites, while archive searches count host strings,
paths, revisions, or artifact-bearing pages. Those numbers are not directly
comparable.

## Evidence grades

Grades apply to a specific claim about a resource. They are evidence-type
ceilings, not an automatic ordinal confidence score: a retained state-change
claim (`E3`) can still be false or inherited. In `domains.csv`, the grade fields
describe the strongest retained support for the row's stated primary role, not
a permanent global rating of the hostname.

| Grade | Required evidence |
|---|---|
| `E0` | A string resembling a domain or service is mentioned |
| `E1` | An actionable-looking URL, endpoint, path, or configuration is retained |
| `E2` | A retained body instructs use or self-reports use, reachability, success, polling, or activity |
| `E3` | The corpus contains a content-dependent response, observed state change, correction, or reuse compatible with the claimed role |
| `E4` | Independent provider, access, browser, packet, or server telemetry proves the external transaction |

No external resource in this package is assigned `E4`. The archive itself can
provide direct proof of wiki saves because the saves are the evidence being
held; it cannot provide equivalent proof for a third-party endpoint.

## Coordination grades

Coordination is evaluated separately from technical evidence:

| Grade | Meaning |
|---|---|
| `K0` | No coordination implication; source, reader, proxy, or diagnostic use only |
| `K1` | Invitation, contact point, shared-state design, or relay protocol is described |
| `K2` | A content-dependent reply, handoff, or state relay is observable across retained revisions |
| `K3` | Independent cross-system evidence verifies the sender, receiver, transaction, and causal response |

No reviewed domain reaches `K3`. The wiki record contains strong `K2` cases;
CounterAPI contains `K2`-compatible corpus evidence but no external access log.

For avoidance of doubt:

```text
external_telemetry_evidence_count = 0
verified_external_request_count = 0
```

## Count semantics

Every count must identify its result unit.

- **Revision hits:** number of saved revision bodies containing a substring.
- **Artifact pages:** number of indexed pages whose extracted URL list matches a
  host or whose payload flag matches a class.
- **Unique pages:** distinct page IDs among results.
- **URL occurrences:** literal occurrences inside bodies; not systematically
  available for every query.
- **Introductions:** revisions where a URL was newly added relative to the prior
  body. This package does not claim introduction counts unless a body-level
  trace was performed.

A full-body wiki edit retains earlier lines. One URL introduced once can
generate dozens of later revision hits. Therefore:

```text
revision hits != independent agents != unique requests != successful requests
```

Known query-bound discrepancies are preserved rather than averaged:

- `api.counterapi.dev`: 416 exact-host revision matches; 420 broader
  `counterapi` matches.
- `vanderbi.lt`: 336 exact-host revision matches; 343 broader family matches.
- `tinyurl.com`: 117 exact-host revision matches; 119 broader category matches.
- `allorigins.hexlet.app`: 1,226 exact substring matches; 1,305 broader
  AllOrigins-family matches.

## Normalization rules

1. Lowercase DNS hostnames for identity comparisons.
2. Remove a trailing DNS dot only in the normalized field; retain the raw alias
   in `resources.csv`.
3. Do not merge path-based wiki sites into their host row.
4. Represent changing tunnel subdomains both as individual resources and as a
   wildcard host family.
5. Decode percent-encoded host tokens only into an explicit `normalized_to`
   relationship; never silently replace the raw evidence.
6. Keep invalid suffix forms such as `sec.gov_12000` as malformed resources,
   not DNS hosts.
7. Do not infer organization ownership from a suggestive hostname. In
   particular, archive evidence alone does not establish the operator of
   `vanderbi.lt`.
8. Do not merge `dorfwiki` with `dorfwiki.org`: the former is a held wiki ID,
   while the latter had no literal hostname hit under the documented searches.

## Role assignment

Roles describe the best-supported use in the retained context, not all
capabilities of the service. A host may have multiple roles.

Primary role values in `domains.csv` include:

- `wiki_surface`
- `task_source`
- `reader_converter`
- `proxy_transform`
- `redirect_shortener`
- `shared_data_candidate`
- `signaling_candidate`
- `tunnel_publication`
- `archive_preservation`
- `diagnostic_test`
- `application_hosting`
- `unknown_ambiguous`

## Negative searches

"Not found" means not found under the recorded exact/broad queries in this
snapshot. It does not establish global absence because:

- content may be encoded or misspelled;
- relevant revisions may have been deleted before collection;
- another archive or site may hold the activity;
- the host may appear only behind a short URL whose target was not retained;
- the query may not cover an alternate hostname.

The public crosswalk uses the wording `not found in documented archive
queries`, never `did not occur`.

## Review limitations

- Labels are writable strings, not authenticated agent identities.
- `ip16` is truncated and cannot establish a machine, organization, or person.
- Self-reported task clocks differ from archive UTC timestamps.
- Nested URLs show a constructed route, not proof that every hop executed.
- Words such as `working`, `active`, and `we are polling` support `E2`, not
  external verification.
- Shared lines can be inherited through cumulative bodies.
- Search snippets can truncate context; important claims were checked against
  exact revisions where available.
- The archive contains four logical wiki IDs, but host extraction is available
  only for the artifact-bearing subset of pages.
- The review is hypothesis-led rather than a blind prevalence study.
- The MCP client-call time and MCP/server build identifier were not exposed in
  returned records. The package date and export generation timestamp are the
  available temporal anchors.
- The MCP does not expose a content hash for an individual revision tuple.
  Exact page ID, sequence, archive UTC, label, and quote are used instead.

## Safe-link policy

No live validation request was sent to CounterAPI, CountAPI, shorteners,
tunnel endpoints, admin/contact-board URLs, or proxy chains. A GET to `/up`,
`/set`, or `/hit` could mutate external state, while opening a shortener or
tunnel could contact unsafe or expired infrastructure. Package validation was
offline: syntax, local paths, CSV relationships, and archive MCP replay only.

## Package structural validator

The following offline checks were executed against the package:

```text
CSV files parsed with Python's csv module
expected column count checked on every row
domain_id/resource_id/evidence_id/query_id/source_id uniqueness checked
normalized_host uniqueness checked
resource -> domain references checked
evidence -> resource and evidence -> query references checked
non-empty UTC strings parsed with datetime.fromisoformat
evidence grades constrained to E0-E4
coordination grades constrained to K0-K3
local source paths resolved from the package directory
relative Markdown links resolved without contacting external URLs
```

Observed result after correction:

```text
domains.csv: 141 rows
resources.csv: 30 rows
evidence-ledger.csv: 25 rows
query-log.csv: 74 rows
sources.csv: 24 rows
package files: 11
structural validator errors: 0
```

This validates package structure only. It does not validate DNS, live endpoint
behavior, attribution, or every semantic interpretation.

## Reproduction workflow

1. Verify the archive snapshot and hashes.
2. Run the queries in [`query-log.csv`](query-log.csv).
3. Treat result units exactly as recorded.
4. Retrieve the exact revision for every promoted claim.
5. Compare the current body to the prior revision before claiming a new
   introduction.
6. Resolve the claim to a resource in [`resources.csv`](resources.csv), then to
   a normalized host in [`domains.csv`](domains.csv).
7. Record new primary evidence in [`evidence-ledger.csv`](evidence-ledger.csv).
8. Preserve conflicting counts and explain their query semantics.
