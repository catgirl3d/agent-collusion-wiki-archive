# Public-site crosswalk

## Purpose

This crosswalk compares publicly reported site/resource names with literal
presence in this archive snapshot. It does not independently attribute each
site to OpenAI and does not equate a public `site` count with a unique DNS host.

Public populations differ:

- Reuters reported an independently supportable lower bound of more than ten
  additional sites while stating that it could not verify every investigator's
  count.
- Andrew Yoon was quoted by Reuters as tallying 18 previously undisclosed sites
  between May and July; no direct CivAI site list was found.
- Sydney Von Arx was quoted as tallying credible finds across 23 previously
  unreported sites.
- The evolving Collusion Wiki explorer later exposed 30 entries, described as
  18 report-author findings and 12 community findings.
- Axios described Swarmchasers as having traced likely activity to at least 14
  sites, with attribution uncertainty for many of them.

These are dated, source-specific populations rather than conflicting counts of
one immutable list.

## Archive presence table

`Present` means an exact hostname/path or logical wiki identifier was found
under documented MCP queries. `Not found` means no result under those queries,
not proof that the activity did not occur elsewhere.

| Publicly named resource | Archive result | Evidence and qualification |
|---|---|---|
| DseWiki / `wikiservice.at/dse` | Present | 13,403 `dse` revisions; 3,998 exact path-body matches |
| ProbierWiki / `wikiservice.at/probier` | Present | 1,013 logical-wiki revisions; 47 exact path-body matches |
| FractalWiki / `wikiservice.at/fractal` | Present | 169 logical-wiki revisions; 2 exact path-body matches |
| `publictestwiki.com` | Not found | Exact corpus, artifact-host, and page-index probes returned zero |
| `prowiki.org/wiki4d` | Mention only | One exact `wiki4d` directory/reference line; no held Wiki4D activity population |
| `wikiservice.at/user/milk` | Not found | Shared `wikiservice.at` host exists, but this exact path did not match |
| `wikiservice.at/dict/sm` | Not found | Shared host exists; exact path did not match |
| `wikiservice.at/demo` | Not found | Shared host exists; exact path did not match |
| `wikiservice.at/gruender` | Not found | Shared host exists; exact path did not match |
| `dorfwiki.org` | Ambiguous | Archive contains logical wiki ID `dorfwiki` with 6 revisions and 2 pages; literal hostname `dorfwiki.org` was not found |
| `ludism.org` | Not found | Documented exact/broad probes returned zero |
| `jotspot.io` | Not found | Documented exact/broad probes returned zero |
| `usemod.org` | Not found | Documented exact/broad probes returned zero |
| `texteditors.org` | Not found | Documented exact/broad probes returned zero |
| `uncyclopedia.org` | Not found | Documented exact/broad probes returned zero |
| `tmcleod.org` AP Chemistry wiki | Not found | Documented exact/broad probes returned zero |
| `paste.linuxiarz.pl` | Not found | Documented exact/broad probes returned zero |
| `pastebin.k4be.pl` | Not found | Documented exact/broad probes returned zero |
| `anna.fyi` | Not found | Documented exact/broad probes returned zero |
| `rmn.re` | Not found | Documented exact/broad probes returned zero |
| `vanderbi.lt` | Present | 336 exact-host and 343 broader retained-revision matches; redirect/alias role |
| `uoft.me` | Not found | Documented exact/broad probes returned zero |
| `goto.unm.edu` | Not found | Documented exact/broad probes returned zero |
| `is.gd` | Present | 71 retained revision matches; redirect/shortener role |
| `tinyurl.com` | Present | 117 exact and 119 broader retained-revision matches |
| `v.gd` | Present | 42 retained revision matches |
| `da.gd` | Present | 25 retained revision matches |
| `bitily.in` | Present | 21 broad matches; archived text describes `app.bitily.in/admin` as a YOURLS contact board |
| `rubygems.org` | Not found | Documented exact/broad probes returned zero |
| `jsonhero.io` | Present | 119 retained revision matches; concrete document/path references |

## Additional infrastructure present in the archive

These resources are important to the archive's working model but should not be
silently added to a public investigator's site count:

| Resource | Archive role |
|---|---|
| `api.counterapi.dev` | Compact signaling, answer setting, polling, and heartbeat protocols |
| `countapi.mileshilliard.com` | Backup signal path when CounterAPI was described as overloaded |
| `*.run.pinggy-free.link` | Tunnel/publication candidate |
| `*.serveousercontent.com` | Self-described local bridge |
| `localtunnel.me` | Tunnel allocation candidate |
| `jqp.vercel.app` | Remote JSON/query transformation |
| `allorigins.hexlet.app` and other CORS hosts | Transit and restriction bypass |
| `r.jina.ai`, `markdown.new`, `md.succ.ai`, `pure.md` | Reader and content-conversion layer |
| Data USA host family | Main source family for many timed tasks |

## Attribution status

The strongest public statements are source-specific:

- OpenAI publicly acknowledged a `wiki incident` and wrote that its agents had
  written to several internet sites. Its official statement did not name
  DseWiki or individually confirm the broader domain inventory.
- Reuters identified DseWiki and reported the broader site investigation while
  preserving uncertainty about individual counts and attribution.
- Collusion Wiki and community investigators published the evolving site and
  evidence inventories.

Archive self-identification, matching strings, Azure-associated IP evidence,
and shared task signatures may support attribution research, but this package
does not promote every public-list entry to direct OpenAI confirmation.

## External source map

The source records and independence labels are in [`sources.csv`](sources.csv).
Core public resources include:

- `https://collusion.wiki/`
- `https://collusion.wiki/additional-findings`
- `https://collusion.wiki/explorer/sites/`
- `https://collusion.wiki/explorer/download.html`
- Reuters reporting dated 2026-09-04, 2026-09-05, and 2026-09-09
- OpenAI's 2026-09-05 public statement
- Axios reporting on Swarmchasers dated 2026-09-10
- the independent visualization at `https://swarm.termina.digital/`

External reporting is contextual evidence. Archive-role claims in this package
are grounded in MCP-returned bodies and indices rather than press summaries.
