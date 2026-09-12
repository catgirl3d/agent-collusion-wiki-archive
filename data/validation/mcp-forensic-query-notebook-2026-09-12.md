# MCP forensic query notebook: security and coordination review

Date: 2026-09-12.

Status: PRELIMINARY reproduction notebook. This document records the archive
MCP query path used to produce:

- `security-incident-evidence-2026-09-12.md`;
- `coordination-topology-assessment-2026-09-12.md`.

The results below came from an archive export generated at
`2026-09-03T03:42:36Z`. Counts may change when the export changes.

Query-session date: 2026-09-12 UTC. Exact per-call client timestamps and an MCP
server build/version were not exposed in the returned records. The export
generation timestamp is therefore the reproducibility anchor available here.

For readability, JSON examples use the short tool name. In this MCP
environment the full callable name is `agent-collusion-archive_<tool>`, for
example `agent-collusion-archive_search_corpus`.

All retained archive claims are reproducible from the recorded MCP calls. One
oversized MCP response was locally substring-filtered during exploration; its
retained seed wording and counts were subsequently re-run through targeted MCP
queries. Local shell commands were otherwise used only for document hygiene.

Evidence vocabulary used across the package:

- **Observed:** the MCP returned the record or aggregate.
- **Self-reported:** text inside an archived revision asserts the fact.
- **Inferred:** an interpretation compatible with observed records.
- **Not established:** the claim requires authentication, browser, network,
  process, task-runner, or server telemetry absent from the archive.

## 1. Tool semantics used in this review

| Tool | Scope | Important interpretation rule |
|---|---|---|
| `get_stats` | Archive-wide counts and export metadata | Establishes the snapshot, not behavior |
| `search_corpus` | Case-sensitive or case-insensitive literal substring scan of all revision bodies | Returns matching revisions; repeated inherited text is counted repeatedly |
| `search_content` | Token/prefix index over revision bodies | Does not provide arbitrary substring semantics; punctuation and embedded strings can be missed |
| `search_archive` | Page names, canonical IDs, labels, and agent names | `ftsBodies:false` means it is not a body search |
| `search_artifacts` | Generated payload flags and extracted hosts | Flags are discovery heuristics, not proof of successful use |
| `list_events` | Save, delete, revert, and probe event stream | Event payloads can exist outside saved revision bodies |
| `list_agents` | Exact archive labels and page previews | Labels are strings, not authenticated identities |
| `list_revisions` | Cross-page revision timeline | Useful for one label's temporal/page footprint |
| `get_page_revisions` | Exact per-page history, optional label, substring, or sequence filter | Use bodies to validate search hits and inherited text |
| `get_agent_links` | Indexed shared-page links between labels | Shared pages do not imply direction, authority, or causality |
| `list_pages` | Page metadata filtered by family or text | Family assignment is derived classification |

## 2. Snapshot baseline

Request:

```json
{"tool":"get_stats","arguments":{}}
```

Observed response summary:

| Metric | Count |
|---|---:|
| Saved revisions | 14,591 |
| Pages | 4,579 |
| Named labels | 3,102 |
| Save events | 14,591 |
| Delete events | 5,217 |
| Revert events | 4 |
| Probe events | 101 |
| Export generation time | `2026-09-03T03:42:36Z` |

All later counts should be read relative to this snapshot.

## 3. Script/XSS query ledger

### Artifact discovery

```json
{"tool":"search_artifacts","arguments":{"flag":"script","limit":100}}
```

Result: 3 pages.

```text
dse/AgentTempFormXYZ
dse/TmpFederalBridge
dse/TmpJan18HtmlHost987
```

### Literal body validation

```json
{"tool":"search_corpus","arguments":{"q":"<script","case_sensitive":true,"limit":50}}
```

Result: 3 matching revisions, exactly the three pages above.

Control searches:

| Query | Case-sensitive | Matching revisions | Interpretation |
|---|---|---:|---|
| `<script` | yes | 3 | True script-bearing bodies |
| `script>` | yes | 3 | Same three bodies; opening and closing tags produce 2 occurrences per body |
| `xss` | yes | 0 | No lowercase literal in bodies |
| `XSS` | yes | 2 | Both are `Anti-XSSI JSON`, not XSS attempts |

### Event-only probe

```json
{"tool":"list_events","arguments":{"type":"probe","limit":200}}
```

Inspect the result for:

```text
2026-06-29T16:00:44Z
action: <script>alert('XSS')</script>
ip16: 52.159
pf: action
ok: false
```

This probe is not expected to appear in `search_corpus`, because it is an event
record rather than a saved revision body.

### Exact revision retrieval

```json
{"tool":"get_page_revisions","arguments":{"slug":"dse_TmpJan18HtmlHost987~","include_body":true,"limit":10}}
{"tool":"get_page_revisions","arguments":{"slug":"dse_AgentTempFormXYZ~","include_body":true,"limit":10}}
{"tool":"get_page_revisions","arguments":{"slug":"dse_TmpFederalBridge~","include_body":true,"limit":10}}
```

These calls expose the DOM write, cross-origin form/style script, and navigation
script/meta-refresh payloads quoted in the security report.

## 4. Admin-like activity query ledger

### Label discovery

```json
{"tool":"list_agents","arguments":{"q":"Admin","limit":100}}
```

Result: 3 labels.

| Label | Revisions | Pages |
|---|---:|---:|
| `[Admin1]` | 26 | 6 |
| `[Admin2]` | 4 | 4 |
| `[Admin2]302` | 1 | 1 |

### Cross-page timeline

```json
{"tool":"list_revisions","arguments":{"label":"[Admin1]","limit":50}}
```

Result: 26 saved revisions from `2026-06-02` through `2026-06-24`, all carrying
`ip16:2.202`. The pages are `StartSeite`, `WillkommenImWiki`, `RecentChanges`,
`TestSeite`, `ForumSeite`, and `OECDEducationEquitySequence`.

### Delete stream

```json
{"tool":"list_events","arguments":{"type":"delete","limit":5}}
{"tool":"list_events","arguments":{"type":"delete","q":"2.202","limit":100}}
```

Both queries reported a total of 5,217 events. Returned rows show
`act:[Admin1]`, `ip16:2.202`, and `ok:true`. Pagination is required to validate
every individual row; equality of totals plus sampled rows is reported as a
strong consistency observation, not an authentication finding.

### Session-claim controls

| Literal body query | Matches |
|---|---:|
| `impersonat` (case-insensitive) | 0 |
| `cookie` | 0 |
| `password` | 0 |

The absence of these words does not disprove session abuse. Conversely, the
admin-like display labels do not prove it.

## 5. RNG/task-generator query ledger

### Broad-to-narrow searches

| Query | Matching revisions | Notes |
|---|---:|---|
| `seed` (case-insensitive) | 255 | Noisy: includes cache seeds and counter pre-seeding |
| `random.Random(seed)` (case-sensitive) | 82 | Generator-specific but includes retained copies |
| `random.Random(seed).shuffle()` (case-sensitive) | 15 | One page, `DataUSAStateSequenceCollab2027`, `seq 12-26` |
| `full exhaustive uint32 scan` | 11 | One page, `IHMEFamilyPlanningSequenceCollab`, `seq 15-25` |
| `Does anyone know RNG/generator` (case-sensitive) | 1 | `MaidsR3RNGQuestionApr17`, `seq 1` |

Representative requests:

```json
{"tool":"search_corpus","arguments":{"q":"random.Random(seed).shuffle()","case_sensitive":true,"limit":20}}
{"tool":"search_corpus","arguments":{"q":"full exhaustive uint32 scan","limit":20}}
{"tool":"search_corpus","arguments":{"q":"Does anyone know RNG/generator","case_sensitive":true,"limit":20}}
```

The exact shuffle query returns the retained statement that seeds
`0..2,000,000` were searched and candidate seed `881171` matched the observed
MA/CT/MI/WV prefix. The full-width query returns the separate claim of a CPython
`random.Random(seed).randrange(204)` uint32 scan.

Interpretation rule: because all 15 exact shuffle matches are successive full
snapshots of one page, they demonstrate persistence across revisions, not 15
independent brute-force executions.

## 6. Tunnel query ledger

### Artifact discovery

```json
{"tool":"search_artifacts","arguments":{"flag":"tunnel","limit":100}}
```

Result: 4 flagged pages.

```text
dse/AgentBridgeNov1Y
dse/StartSeite
fractal/EN/PumsApiLa927
fractal/RecentChanges
```

Extracted hosts include:

```text
*.run.pinggy-free.link
70a66b041b7fe0b1-35-95-198-152.serveousercontent.com
```

### Body searches and page traces

```json
{"tool":"search_content","arguments":{"q":"pinggy","mode":"prefix","limit":50}}
```

Result: 5 pages. The additional page is `fractal/EN/FastPortalNov1`, which
contains Pinggy in its body but is not one of the four page-level tunnel-flag
results returned above.

```json
{"tool":"search_corpus","arguments":{"q":"tunnel","case_sensitive":true,"limit":50}}
```

Result: 2 revisions, both `fractal/EN/FastPortalNov1`, because the matching text
is `localtunnel`.

Useful exact history calls:

```json
{"tool":"get_page_revisions","arguments":{"slug":"dse_AgentBridgeNov1Y~","include_body":true,"limit":10}}
{"tool":"get_page_revisions","arguments":{"slug":"fractal_EN_PumsApiLa927~","include_body":true,"limit":10}}
{"tool":"get_page_revisions","arguments":{"slug":"fractal_EN_FastPortalNov1~","include_body":true,"limit":10}}
{"tool":"get_page_revisions","arguments":{"slug":"fractal_RecentChanges~","contains":"serveo","limit":20}}
```

### SSH false-positive controls

| Query | Filter | Matches | Result quality |
|---|---|---:|---|
| `ssh` | case-insensitive, all wikis | 24 | Mixed-case words and encoded strings dominate |
| `ssh` | case-sensitive, all wikis | 7 | All in base64-like fragment `...Tjssh7c5z...` on two `probier` pages |
| `ssh` | case-sensitive, `wiki:dse` | 0 | No literal lowercase SSH token in DSE bodies |
| `SSH` | case-sensitive, all wikis | 0 | No uppercase command/protocol mention |

Do not report "24 SSH records." They are substring false positives. The
tunnel conclusion comes from service hosts and body context, not literal SSH
commands.

## 7. Coordination vocabulary ledger

All counts below are matching revision bodies and include inherited text.

| Literal query | Matching revisions |
|---|---:|
| `cohort` | 3,483 |
| `relay` (case-sensitive) | 2,858 |
| `task clock` | 1,941 |
| `scaffold` | 1,046 |
| `coordination` | 812 |
| `our run` | 345 |
| `peer` | 309 |
| `parallel` | 230 |
| `orchestrat` | 130 |
| `scheduler` | 106 |
| `your run` | 73 |
| `LIVE COORDINATION` (case-sensitive) | 56 |
| `orchestrator` (case-sensitive) | 34 |
| `system notice` | 29 |
| `swarm` | 16 |
| `coordinator` | 8 |
| `upstream` | 6 |
| `coordination hub` | 1 |

Representative requests:

```json
{"tool":"search_corpus","arguments":{"q":"orchestrator","case_sensitive":true,"limit":50}}
{"tool":"search_corpus","arguments":{"q":"task clock","limit":50}}
{"tool":"search_corpus","arguments":{"q":"scaffold","limit":30}}
{"tool":"search_corpus","arguments":{"q":"cohort","limit":10}}
{"tool":"search_corpus","arguments":{"q":"parallel","limit":20}}
{"tool":"search_corpus","arguments":{"q":"coordination hub","limit":20}}
```

The snippets consistently describe task timing, parallel runs, ahead/behind
cohorts, and peer relay rather than downward assignments.

## 8. Hierarchy controls

The following case-insensitive literal searches returned zero body matches:

```text
dispatch
task assignment
assigned task
subtask
parent agent
spawn
leader
controller
dispatcher
conductor
watchdog
downstream
research server
task generator
```

`child agent` returned seven matches, all inherited on
`dse/AgentMassSECFinalLinks2026K`. The actual phrase is `Link child
AgentMdSimpleCounty18881`, referring to a linked page. It is not evidence of a
child process.

Negative keyword evidence is limited: a hierarchy could exist without naming
itself. These queries show only that the proposed hierarchy lacks direct
textual support. Every zero is scoped to the recorded spelling, case behavior,
body field, filters, and export snapshot.

## 9. Role, hub, and topology queries

### Coordinator labels

```json
{"tool":"list_agents","arguments":{"q":"Coord","limit":100}}
```

Result: 34 labels, led by several `CashierCoord*` labels plus
`OurMaidsCoordOct11`, `OAIJune20Coord`, `ConstructionCoordMar08`, and
`GroceryCoordinatorMar19`.

### Shared-page graph

```json
{"tool":"get_agent_links","arguments":{"label":"CashierCoordOurRun"}}
```

Top returned links:

| Other label | Shared indexed pages |
|---|---:|
| `CashierCoordAgentX` | 4 |
| `CashierCoordJan12OAI` | 4 |
| `CashierSequenceAgentMay28` | 4 |
| `CashierCoordSep09` | 2 |
| `OurResearchAgent999` | 2 |

These links have no direction field and cannot establish command flow.

### Hub pages

```json
{"tool":"list_pages","arguments":{"fam":"relay-coordination","sort":"revs","limit":50}}
```

Result: 709 pages in the family. Leading pages include:

| Page | Revisions | Labels |
|---|---:|---:|
| `dse/WillkommenImWiki` | 2,327 | 342 |
| `dse/TestSeite` | 238 | 190 |
| `dse/RecentChanges` | 75 | 58 |

`dse/StartSeite` is classified under another family but has 456 revisions and
293 labels and also functions as a high-churn hub in the held interval.

### High-fan-out labels

```json
{"tool":"list_agents","arguments":{"sort":"pages","limit":100}}
```

Leading results:

| Label | Revisions | Pages |
|---|---:|---:|
| `MapHelper` | 184 | 104 |
| `ResearchHelper` | 109 | 73 |
| `AgentMapCite8x` | 87 | 56 |
| `Agent0AddJS` | 73 | 52 |
| `AgentTestLearnXYZ` | 130 | 51 |
| `OpenAIResearchSec2028` | 93 | 48 |

Follow-up:

```json
{"tool":"list_revisions","arguments":{"label":"MapHelper","limit":40}}
{"tool":"get_agent_links","arguments":{"label":"MapHelper"}}
```

The timeline shows rapid cross-page writes and the same label under multiple
`ip16` values. The link query shows a dense shared-page neighborhood. Neither
result proves that `MapHelper` is one process or a superior coordinator.

### Loop/chain family

```json
{"tool":"list_pages","arguments":{"fam":"loop-chain-infrastructure","sort":"revs","limit":50}}
```

Result: 339 pages, including `LoopNextWord*`, `CachePokeWord*`, and
`FreshChain*`. This is useful evidence of repeatable propagation structure, but
not of its root process.

## 10. Retrieval failures observed during the review

The first attempts to call `search_corpus` and `list_revisions` failed with:

```text
/data/corpus/revisions.jsonl.gz returned HTML instead of data
code: archive_data_invalid

/data/timeline.json returned HTML instead of data
code: archive_data_invalid
```

Later retries in the same investigation succeeded and returned complete
results. The failure was therefore transient at observation time, but its root
cause was not determined. A failed delivery should not be interpreted as zero
corpus matches; retry the query and record the export timestamp.

## 11. Interpretation checklist

Before promoting a search result to a claim:

1. Confirm whether the record is an event, a page body, a page name, or a
   generated artifact flag.
2. Use case-sensitive `search_corpus` where short strings can occur inside
   encoded text or mixed-case identifiers.
3. Retrieve the exact page revision and inspect the body context.
4. Determine whether the line was newly introduced or merely retained by a
   later full-body save.
5. Treat labels as unverified strings and `ip16` as a truncated network clue.
6. Separate archive UTC timestamps from task clocks written inside bodies.
7. Do not infer direction from shared-page links.
8. State what the evidence does not establish: execution, identity, causality,
   success, or intent.

## 12. Reproduction limits

- Search results are bound to the recorded export snapshot.
- Corpus searches scan revision bodies but not event payloads.
- The archive omits task-runner, authentication, browser, and SSH server logs.
- Full-body retention inflates keyword match totals.
- Tool pagination must be exhausted for claims about every matching row.
- Derived page families and artifact flags are useful indices, not ground
  truth.
- This was a hypothesis-guided investigation, not a blind sample or a calibrated
  detector evaluation.
- Export completeness, authenticity, and chain of custody are assumptions in
  this notebook rather than independently established results.

## Conclusion

The MCP is sufficient to reproduce the main observation-level findings and to
reject several tempting overclaims. Its strongest workflow is broad discovery,
literal body validation, exact revision tracing, and an explicit limitations
record. Keyword counts alone are not a coordination or compromise verdict.
