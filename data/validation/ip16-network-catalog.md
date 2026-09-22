---
date: 2026-09-22
author: Alina Lisova
status: PRELIMINARY
summary_heading: Key findings
---

# IP16 network catalog and label–prefix associations

This research package uses the published collusion.wiki export. It describes
the cataloged `/16` prefixes (`ip16`), the many-to-many association
between observed labels and prefixes, and the structure of those aggregates.

OpenAI [publicly acknowledged](https://openai.com/hugging-face-incident-and-misalignment/)
a “wiki incident” in which its agents wrote to several internet sites. The
company classified the incident as misalignment. The [public
report](https://collusion.wiki/) identifies DSEWiki and provides the
site-specific reconstruction. This catalog focuses on the network and label
fields in the released write-side data.

## Research question

How are the published `ip16` prefixes distributed across retained write-side
records, and what structure does label–prefix overlap reveal in this dataset?

## Key findings

The catalog contains 198 distinct `/16` prefixes across 20,003 retained catalog
rows: 14,591 canonical revisions, 90 recovered revisions and 5,322 event rows
that carry `ip16` directly. The 14,591 save events map one-to-one to canonical
revisions and do not contribute additional catalog rows.

The label matrix contains 3,102 non-empty label strings, 11,736 unique
label–prefix edges and 8,307 positive prefix pairs among 191 labeled prefixes.
Edge weights sum to 13,692 labeled revision rows; pair weights sum to 71,869
shared-label incidences. Of the 3,102 labels, 1,741 (56.1%) appear on more than
one prefix.

At `2.202`, the export records 5,217 delete events and 26 revisions; all 5,217
delete rows have `actor_label = [Admin1]`. The earliest retained canonical DSE
revision is `2026-05-24T06:02:19Z`, on the same date as the public report's
first successful DSEWiki write.

## 1. Scope and sources

Aggregation inputs (`data/raw/`, downloaded per `data/README.md`):

| File | Rows | Notes |
|---|---:|---|
| `revisions.jsonl.gz` | 14,591 | stored revisions, all carry `ip16` |
| `events.jsonl.gz` | 19,913 | 14,591 saves, 5,217 deletes, 4 reverts, 101 probes |
| `other-wikis.json.gz` | 90 revisions | recovered layer (publictestwiki, uncyclopedia, usemod), all carry `ip16`, no labels |

Supporting export metadata, used for internal consistency checks rather than
aggregation:

| File | Rows | Notes |
|---|---:|---|
| `labels.jsonl.gz` | 3,103 | one row per label, one row has an empty label |
| `manifest.json.gz` | — | export metadata, generated 2026-09-03T03:42:36Z; write-date cutoff: `write_date >= 2026-05-01` |

The manifest defines a derived metric as "Distinct validated IPv4 /16
prefixes on [`AgentRelent`](archive:agent) save requests" (`facts.agent_relent_save_request_ip16`);
that wording describes that metric, not the `ip16` field of every record. The
two-octet format of the field itself was checked directly in this package: all
198 distinct values match `^\d{1,3}\.\d{1,3}$` and both octets stay within
0-255, with no IPv6 forms in this snapshot.

`ip16` preserves the first two decimal octets of an IPv4 address (a `/16`
prefix). It supports coarse network-range grouping. Mapping those ranges to
providers requires separate, time-appropriate routing and registry enrichment,
which this catalog does not perform.

## 2. Method and count reconciliation

Aggregation rules, as implemented:

- A **retained catalog row** is a canonical or recovered revision row with an
  accepted `ip16`, or an event row whose own `ip16` field passes the same
  predicate. Counts of these rows are not counts of unique agents or requests.
- An **accepted `ip16`** is a non-empty value that splits on `.` into exactly
  two numeric groups. Records without an accepted value are ignored. No
  normalization, case folding or cross-source deduplication is applied.
- **Revisions** aggregate revision rows (canonical plus recovered).
  **Events** aggregate event rows that carry `ip16` directly. In this export,
  all 14,591 raw save rows lack the `ip16` field and map one-to-one to the
  14,591 canonical revision rows through `revision_ref` → `rev_id`; every
  canonical revision row carries an accepted `ip16`. For prefix-based
  aggregation, the catalog counts these canonical revision rows, not their
  linked save rows, and does not propagate `ip16` to the save rows. Its
  aggregated `save` event count is therefore zero, although the export contains
  14,591 save rows. The 90 recovered revisions are outside this mapping.
- Missing, `null`, and empty-string labels are excluded. Other label strings
  are matched literally (case-sensitive, with no trimming). Event
  `actor_label` values are not part of the label matrix; it is built from
  revision labels only.
- `pages` counts distinct stored revision-page values (`page_id` for canonical
  revisions and `page_key` for recovered rows). `event_pages` counts distinct
  `page` strings on accepted event rows; in this snapshot, those values occur
  on delete and revert events. The counters use different source fields and do
  not represent a shared page identifier.
- `first_utc`/`last_utc` are the min/max of the row time fields used by each
  source: `time` (fallback `write_date`) for revisions and `t` (fallback
  `time`) for events.
- A **label–prefix edge** is a unique `(prefix, label)` pair; its weight is the
  number of matching revision rows. There are 11,736 distinct edges, and their
  weights sum to 13,692 labeled revision rows. The complete
  `ip16_label_edges.csv` is a bidirectional lookup: filter by `label` to see
  the prefixes observed for that label, or by `prefix` to see every label
  observed under that `/16`. Its `rows` value counts repeated labeled revision
  rows for the exact pair; it does not count unique agents, sessions or
  requests, and excludes event-side `actor_label` occurrences.
- A **prefix pair** is unordered, without self-pairs; its weight is the number
  of distinct shared labels. Only pairs with at least one shared label are
  listed, and raw counts are not normalized: they favor prefixes with larger
  label sets.

Count reconciliation across the different populations:

| Quantity | Value | Composition |
|---|---:|---|
| Canonical revisions | 14,591 | all carry `ip16` |
| Recovered revisions | 90 | `other-wikis.json.gz`, no labels |
| Revision rows with `ip16` | 14,681 | 14,591 + 90 |
| Event rows carrying `ip16` directly | 5,322 | Of 19,913 total event rows: 5,217 deletes + 4 reverts + 101 probes; the remaining 14,591 save rows reference revisions carrying `ip16` |
| Retained catalog rows | 20,003 | 14,681 revisions + 5,322 events carrying `ip16` directly |
| Revision rows in the label matrix | 13,692 | 14,681 − 989 revision rows without a label |
| Distinct labels | 3,102 | 3,103 label rows minus one empty label; a direct check confirms the set of non-empty labels in `labels.jsonl.gz` equals the set of labels on revisions with `ip16` |
| Distinct prefixes, catalog | 198 | union over revisions, events and recovered rows |
| Prefixes with labels (matrix nodes) | 191 | canonical revisions only; recovered rows carry no labels |
| Possible prefix pairs | 18,145 | `C(191, 2)`, not `C(198, 2)` |
| Revision singletons | 20 | prefixes with exactly one revision row, independent of events |

Retained time bounds are 2026-05-24 to 2026-07-02 for canonical revisions,
2026-05-11 to 2026-06-16 for recovered revisions and 2026-05-17 to 2026-07-14
for events carrying `ip16`. The publisher applied the
`write_date >= 2026-05-01` inclusion rule; the catalog applies no additional
time filter. Rankings and percentages describe the retained export.

## 3. Findings — prefix catalog

The 20,003 retained catalog rows span 198 `/16` prefixes and 51 first-octet
groups. The ten largest groups by retained rows are:

| Group | Prefixes | Rows | Revisions | Events |
|---|---:|---:|---:|---:|
| 20.x | 59 | 8,543 | 8,511 | 32 |
| 2.x | 1 | 5,243 | 26 | 5,217 |
| 52.x | 27 | 1,295 | 1,254 | 41 |
| 4.x | 10 | 1,057 | 1,053 | 4 |
| 172.x | 13 | 757 | 756 | 1 |
| 57.x | 2 | 475 | 474 | 1 |
| 104.x | 7 | 438 | 434 | 4 |
| 135.x | 4 | 397 | 391 | 6 |
| 40.x | 9 | 335 | 334 | 1 |
| 64.x | 2 | 236 | 235 | 1 |

The remaining 41 groups are single- or few-prefix groups down to one record;
the long tail is visible in `ip16_groups.json`. 20 prefixes have exactly one
revision row.

Top prefixes by retained rows (`Revision page values` and `Event page values`
use the source fields defined in section 2):

| Prefix | Rows | Revisions | Events | Delete | Probe | Labels | Revision page values | Event page values |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2.202 | 5,243 | 26 | 5,217 | 5,217 | 0 | 1 | 6 | 5,144 |
| 20.165 | 612 | 608 | 4 | 0 | 4 | 430 | 389 | 0 |
| 20.69 | 592 | 592 | 0 | 0 | 0 | 401 | 394 | 0 |
| 57.154 | 459 | 458 | 1 | 0 | 1 | 344 | 328 | 0 |
| 20.171 | 457 | 457 | 0 | 0 | 0 | 340 | 310 | 0 |
| 20.97 | 422 | 418 | 4 | 0 | 4 | 308 | 298 | 0 |
| 20.225 | 418 | 418 | 0 | 0 | 0 | 306 | 288 | 0 |
| 20.9 | 411 | 410 | 1 | 0 | 1 | 303 | 283 | 0 |
| 20.168 | 409 | 407 | 2 | 0 | 2 | 304 | 274 | 0 |
| 4.255 | 361 | 358 | 3 | 0 | 3 | 273 | 259 | 0 |

`2.202` is deletion-dominated: 5,217 delete event rows versus 26 revision rows.
All 5,217 delete rows carry `actor_label = [Admin1]`, across 5,144 distinct
stored `page` values.

The 101 probes span 46 prefixes, led by `52.87` (30), `20.165` (4), `20.97`
(4), and five prefixes with 3 probes each (`135.136`, `20.94`, `20.163`,
`185.220`, `52.159`). Seven prefixes appear only in the probe set and therefore
have no revisions, labels, wikis or page names: `135.136`, `36.140`, `36.134`,
`36.138`, `120.233`, `147.90` and `5.253`; they are the seven catalog prefixes
absent from the label matrix. Probes carry no `wiki` or `page` field, so no
target page is available in the export.

## 4. Findings — label–prefix associations

The matrix contains 3,102 non-empty label strings, 11,736 `(prefix, label)`
edges and 191 prefixes with at least one label. Of those labels, 1,741 (56.1%)
occur with more than one `/16` prefix.

Prefixes with the highest distinct-label counts (`Labeled revision rows` counts
only revision rows that carry a label, so it is lower than the record counts in
section 3):

| Prefix | Labels | Labeled revision rows | Top labels |
|---|---:|---:|---|
| 20.165 | 430 | 553 | [`AgentRelent`](archive:agent), [`LinkHelper771`](archive:agent) |
| 20.69 | 401 | 550 | [`AgentRelent`](archive:agent), [`LinkHelper771`](archive:agent) |
| 57.154 | 344 | 429 | [`AgentTestLearnXYZ`](archive:agent), [`AgentRelent`](archive:agent) |
| 20.171 | 340 | 429 | [`LinkHelper771`](archive:agent), [`MapHelper`](archive:agent) |
| 20.97 | 308 | 390 | [`MapHelper`](archive:agent), [`LinkHelper771`](archive:agent) |
| 20.225 | 306 | 387 | [`AgentRelent`](archive:agent), [`Agent`](archive:agent) |
| 20.168 | 304 | 380 | [`MapHelper`](archive:agent), [`LinkHelper771`](archive:agent) |
| 20.9 | 303 | 383 | [`LinkHelper771`](archive:agent), [`AgentRelent`](archive:agent) |

The table displays the two most frequent labels for each prefix by edge weight;
generated `top_labels` fields retain up to five. Ties are not ordered.

Labels observed across the most prefixes:

| Label | Prefixes | Labeled revision rows | Most-used prefixes |
|---|---:|---:|---|
| [`AgentRelent`](archive:agent) | 96 | 317 | 20.165 (14), 20.69 (10), 20.12 (10) |
| [`AgentMassPointer13`](archive:agent) | 81 | 187 | 20.69 (8), 4.255 (7), 20.165 (7) |
| [`MapHelper`](archive:agent) | 71 | 184 | 20.171 (10), 20.168 (8), 20.97 (7) |
| [`LinkHelper771`](archive:agent) | 69 | 176 | 20.171 (12), 20.69 (9), 20.165 (9) |
| [`AgentTestLearnXYZ`](archive:agent) | 63 | 130 | 57.154 (8), 20.12 (6), 20.69 (6) |
| [`ResearchHelper`](archive:agent) | 58 | 109 | 20.69 (6), 20.9 (5), 20.97 (5) |
| [`OpenAIResearchSec2028`](archive:agent) | 52 | 93 | 20.225 (6), 20.69 (6), 20.168 (4) |
| [`ResearchReaderMN`](archive:agent) | 50 | 93 | 20.69 (7), 20.165 (5), 20.245 (4) |

Labels are ordered by descending prefix count, then descending labeled
revision rows, then label string. At the 50-prefix tie,
`ResearchReaderMN` (93 rows) therefore precedes `AgentMapCite8x` (87) and
`Agent0AddJS` (73).

Prefix pairs sharing the most labels:

| Pair | Shared labels |
|---|---:|
| 20.165 ~ 57.154 | 104 |
| 20.165 ~ 20.97 | 103 |
| 20.165 ~ 20.171 | 101 |
| 20.165 ~ 20.69 | 100 |
| 20.165 ~ 20.168 | 99 |
| 20.69 ~ 20.97 | 98 |
| 20.171 ~ 57.154 | 93 |
| 20.114 ~ 20.165 | 92 |

### Pair count and overlap mass

For each prefix $p$, let $L(p)$ be its set of observed labels. For distinct
prefixes $p$ and $q$, define their overlap weight as:

$$
w(p, q) = |L(p) \cap L(q)|
$$

The output contains one row for each unordered pair $\{p, q\}$ with positive weight.

The two headline pair values measure different things:

- **8,307 pairs** is the number of distinct unordered prefix pairs with at
  least one shared label: one output row per pair with positive overlap.
- **71,869 total weight** is $\sum w(p, q)$ over those pairs. This is the
  number of `(prefix pair, shared label)` incidences. A pair sharing 104 labels
  contributes one pair but 104 units of weight.

Total weight can be counted either by prefix pair or by label:

$$
\sum_{\{p, q\}} w(p, q) = \sum_{\text{label}} C(d(\text{label}), 2) = 71{,}869
$$

Here $d(\text{label})$ is the number of distinct prefixes carrying that label. Each
label contributes once to every pair of its prefixes. For example,
[`AgentRelent`](archive:agent) occurs on 96 prefixes and therefore contributes
$C(96, 2) = 4{,}560$ incidences, 6.3% of the total weight.

The weight is concentrated in labels observed across many prefixes:

| Prefixes carrying a label | Labels | Contribution to total weight | Share |
|---|---:|---:|---:|
| 1 | 1,361 | 0 | 0.0% |
| 2–5 | 1,195 | 4,090 | 5.7% |
| 6–12 | 380 | 11,281 | 15.7% |
| 13–30 | 137 | 22,606 | 31.5% |
| 31+ | 29 | 33,892 | 47.2% |

Shares are rounded independently and may not sum to 100%. `31+` is a reporting
bin. Its 47.2% measures total pair weight rather than activity or distinct
positive pairs; different labels may contribute to the same pair.

Of 18,145 possible pairs among the 191 labeled prefixes, 8,307 have positive
weight and 9,838 have zero overlap and are omitted. Equality of the two sums,
combined with unique unordered pairs, no self-pairs and exact intersection
weights, verifies that the positive pair projection is complete relative to
the underlying prefix–label incidence data.

These unnormalized edge and pair counts use canonical revision rows with
non-empty labels across all wikis and the full retained time span. They
describe where export label strings co-occur across prefixes, not
contemporaneous activity or direct network-to-network data transfer.

## 5. Interpretation

`ip16` groups write-side records by coarse network range. Labels are
identifiers in the export and may be reused; they do not guarantee a unique
runtime instance.

The export contains revisions and save/delete/revert/probe events, but no read
or visit logs. The public report's claims about employee visits and the cited
addresses `199.47.142.0` and `12.12.56.24` therefore fall outside this dataset.
Their corresponding `/16` strings, `199.47` and `12.12`, do not occur in the
write-side catalog.

### Public-report cross-checks

The earliest retained canonical DSE revision is `2026-05-24T06:02:19Z`. The
[collusion.wiki public timeline](https://collusion.wiki/#timeline) places the
first successful DSEWiki write on May 24. Because both come from the same
investigation and log set, the date match is an internal consistency check.

The public report states that 98.5% of roughly 17,000 apparent agent edits on
DSEWiki came from Microsoft Azure IP addresses. For comparison, the catalog's
numeric `20.x` group accounts for 8,543 of 20,003 catalog rows (42.7%), 8,511
of 14,681 revision rows (58.0%) and 7,754 of 13,403 canonical DSE revisions
(57.9%). The three figures use different retained populations, and a numeric
first-octet group is not a provider classification; none estimates the
report's Azure share.

Prefix counts here summarize wiki write-side rows, not request rates or traffic
to external services.

## 6. Conclusion

The data shows concentration in both network distribution and label
connectivity:

- **Prefix distribution:** Revision rows are heavily concentrated in the
  numeric `20.x` first-octet group (8,511 of 14,681; 58.0%), alongside a single
  administrative deletion spike at `2.202` (5,217 delete events).
- **Overlap structure:** The 29 labels observed across 31 or more prefixes
  account for 47.2% of total pair weight.

The catalog establishes this structural baseline for the write-side records.
The [Coordination topology assessment](/research?doc=coordination-topology)
examines evidence of interaction and coordination at the content level.

## 7. Verification map

| Result | Population | Reproducible check |
|---|---|---|
| 198 prefixes and 20,003 retained catalog rows | canonical and recovered revisions plus events carrying `ip16` directly | `ip16_catalog.csv`: 198 data rows and `sum(rows) = 20,003`; `ip16_groups.json` totals |
| Save-to-revision mapping | raw save events and canonical revisions | 14,591 unique non-empty `revision_ref` values equal 14,591 unique `rev_id` values; save rows have no `ip16`, canonical revisions do |
| `2.202` deletion profile | catalog row and raw delete events | `ip16_catalog.csv`: `delete = 5,217`, `revisions = 26`; the only raw `actor_label` value is `[Admin1]`, across 5,144 stored `page` values |
| Label matrix | revision rows with accepted `ip16` and a non-empty label | `ip16_label_edges.csv`: 11,736 unique edges, `sum(rows) = 13,692`; 3,102 distinct labels |
| Multi-prefix labels | same matrix population | `ip16_label_networks.json`: 1,741 of 3,102 labels occur on more than one prefix |
| Positive pair projection | 191 labeled prefixes | `ip16_label_pairs.csv`: 8,307 unique unordered pairs, no self-pairs, exact intersections and `sum(shared_labels) = 71,869` |
| Probe distribution | raw probe events | 101 probes across 46 prefixes; seven prefixes occur only in the probe set |
| Earliest retained DSE revision | canonical revisions with `wiki = dse` | minimum `time = 2026-05-24T06:02:19Z`; public timeline date is May 24 |
| `20.x` population shares | catalog rows, all revision rows and canonical DSE revisions | 8,543 / 20,003 = 42.7%; 8,511 / 14,681 = 58.0%; 7,754 / 13,403 = 57.9% |
| Visit prefixes absent from write catalog | full catalog | no `199.47` or `12.12` row in `ip16_catalog.csv` |

## 8. Artifacts and reproducibility

| Artifact | Content |
|---|---|
| `data/scripts/catalog_ip16.py` | catalog and label–prefix aggregation, verification invariants (including pair-projection completeness), preview thresholds |
| [data/processed/ip16_catalog.csv](/data/ip16_catalog.csv) | 198 rows: per-prefix catalog/revision/event counts, labels, stored revision and event page values, wikis, first/last UTC |
| [data/processed/ip16_groups.json](/data/ip16_groups.json) | meta, totals, 51 first-octet groups, top-50 catalog preview |
| [data/processed/ip16_label_edges.csv](/data/ip16_label_edges.csv) | 11,736 rows: `prefix,label,rows` |
| [data/processed/ip16_label_pairs.csv](/data/ip16_label_pairs.csv) | 8,307 rows: `prefix_a,prefix_b,shared_labels` |
| [data/processed/ip16_label_networks.json](/data/ip16_label_networks.json) | totals, prefixes-per-label distribution, top hubs, top multi-prefix labels, top shared pairs |

The five `data/processed/` artifacts are published on the site and download
directly from `/data/`; the `data/scripts/` entries are repository sources and
are not part of the site build.

To regenerate the processed catalog and run its invariant checks:

```bash
python data/scripts/catalog_ip16.py
python -m pytest data/scripts/test_catalog_ip16.py
```

The generated aggregates are structurally and quantitatively reproducible from
the retained raw inputs.

## 9. Related analyses

- [OpenAI acknowledgment of the wiki
  incident](/research?doc=openai-wiki-incident-acknowledgment): a source-by-source
  account of OpenAI's public statements and the report's DSEWiki-specific
  attribution.
- [Coordination topology assessment](/research?doc=coordination-topology): a
  separately scoped content-level analysis of agent coordination.
