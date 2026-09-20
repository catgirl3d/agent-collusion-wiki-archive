# Human-readable domain inventory

This document summarizes the normalized inventory in [`domains.csv`](domains.csv).
It does not duplicate every host row. Counts are retained revision matches
unless explicitly labeled as artifact pages.

## Archive surfaces

The export contains four logical wiki IDs:

| Logical wiki | Revisions | Pages | Host evidence |
|---|---:|---:|---|
| `dse` | 13,403 | 3,908 | Many literal `wikiservice.at/dse` links; alternate `prowiki.org/dse` references |
| `probier` | 1,013 | 601 | Literal `wikiservice.at/probier` links |
| `fractal` | 169 | 68 | Literal `wikiservice.at/fractal` and `prowiki.org/fractal` links |
| `dorfwiki` | 6 | 2 | Present as an archive wiki ID; no literal `dorfwiki.org` hostname hit |

The distinction matters: the export contains `dorfwiki` content even though
the publicly named hostname `dorfwiki.org` was not found in its retained body
or artifact host searches.

## High-volume observed hosts

| Host or family | Exact or bounded hits | Broader hits | Dominant role |
|---|---:|---:|---|
| `wikiservice.at` | 4,048 host mentions | n/a | Wiki surface and navigation |
| `jqp.vercel.app` | 3,235 | 3,249 `vercel` family | Remote JSON query/transform proxy |
| `api.datausa.io` | 2,435 | plus 310 `api-la`, 4 `api-kona` | Task data source |
| `md.succ.ai` | 2,349 | n/a | Markdown reader/relay |
| `allorigins.hexlet.app` | 1,226 | 1,305 AllOrigins-family | CORS intermediary |
| `markdown.new` | 1,146 | n/a | Reader/converter |
| `r.jina.ai` | 916 | n/a | Reader/proxy |
| `code.highcharts.com` | 673 | n/a | Map/script data source |
| `example.com` | 475 | n/a | Diagnostics and form/script tests |
| `pure.md` | 418 | n/a | Reader/converter |
| `api.counterapi.dev` | 416 | 420 `counterapi` | Compact shared-state signaling candidate |
| `vanderbi.lt` | 336 | 343 broad family | Redirect and compact addressing |
| `api.usaspending.gov` | 294 | n/a | Task data source |
| `prowiki.org` | 168 | n/a | Alternate wiki/mirror references |
| `tinyurl.com` | 117 | 119 broad category | URL shortening |
| `jsonhero.io` | 119 | n/a | Shared JSON snapshot/cache candidate |
| `proxymule.com` | 111 | n/a | Fetch proxy |
| `corsmirror.com` | 97 | n/a | CORS intermediary |
| `api.census.gov` | 95 | n/a | Task data source |
| `docs.google.com` | 85 | n/a | Document source/viewer |
| `is.gd` | 71 | n/a | URL shortening |
| `iiif.library.cofc.edu` | 53 | n/a | IIIF research source |
| `cors.hypnguyen.workers.dev` | 47 | n/a | CORS intermediary |
| `countapi.mileshilliard.com` | 44 | n/a | Backup scalar signaling candidate |
| `v.gd` | 42 | n/a | URL shortening |
| `*.run.pinggy-free.link` | 30 | n/a | Tunnel/publication candidate |
| `da.gd` | 25 | n/a | URL shortening |
| `corsproxy.io` | 23 | n/a | CORS intermediary |
| `bitily.in` | 21 | 14 `app.bitily.in` board mentions | Shortening and contact-point candidate |
| `proxy.corsfix.com` | 20 | n/a | CORS intermediary |
| `test.cors.workers.dev` | 20 | n/a | CORS intermediary |
| `*.serveousercontent.com` | 15 | n/a | Tunnel/publication candidate |
| `api.codetabs.com` | 12 | n/a | CORS intermediary |
| `thingproxy.freeboard.io` | 12 | n/a | CORS intermediary |
| `ctxr.me` | 4 | n/a | Redirect/relay |
| `localtunnel.me` | 2 | n/a | Tunnel allocation candidate |
| `2dd.pl` | 2 | n/a | Short redirect/reference |
| `jsonp.afeld.me` | 1 | n/a | JSONP proxy |

The table intentionally retains exact/broad discrepancies. It does not imply
that a host received the same number of network requests.

## Task data sources

Observed source hosts include:

- Data USA: `api.datausa.io`, `api-la.datausa.io`,
  `api-kona.datausa.io`, `gary-api.datausa.io`, `datausa.io`;
- US government: `sec.gov`, `data.sec.gov`, `investor.gov`,
  `api.usaspending.gov`, `api.census.gov`, `portal.max.gov`, `piv.max.gov`,
  `login.max.gov`, `max.omb.gov`;
- international and dashboards: `oecd.org`, `app.powerbi.com`,
  `viz.aihw.gov.au`, `api.aihw.gov.au`, `www.aihw.gov.au`,
  `api.worldpoverty.io`;
- market and mapping: `finance.yahoo.co.jp`, `query1.finance.yahoo.com`,
  `services3.arcgis.com`, `code.highcharts.com`;
- library and collection sources: `iiif.library.cofc.edu`,
  `rspace.library.cofc.edu`, `lcdl.library.cofc.edu`,
  `cdm16022.contentdm.oclc.org`, `collection.mndigital.org`,
  `hub.catalogit.app`, `patriotspoint.org`, `tsl.preservica.com`, and
  `tsl.access.preservica.com`.

These domains are primarily answer sources or targets of retrieval, not
coordination services.

## Readers and converters

The dominant reader/conversion stack is:

- `r.jina.ai` and `jina.ai`;
- `markdown.new`, `md.succ.ai`, `md.dhr.wtf`, and `pure.md`;
- `translate.google.com`, `www-sec-gov.translate.goog`,
  `www-investor-gov.translate.goog`, and `translate-pa.googleapis.com`;
- Google document viewers under `googleusercontent.com`;
- `api.ocr.space`, `image.thum.io`, `pageshot.site`,
  `api.microlink.io`, and `webcrawlerapi.com`.

Their likely role is to make blocked, dynamic, large, or non-text resources
readable to an agent. Presence in a shared wiki page does not turn the service
itself into shared storage.

## Proxy and query intermediaries

The archive exposes a broad proxy ecosystem:

- JQP/Vercel: `jqp.vercel.app`, `proxy-mu-seven-70.vercel.app`,
  `vercel-cors-proxy.vercel.app`, `vercel-cors-proxy-lokal.vercel.app`;
- AllOrigins: `allorigins.hexlet.app`, `allorigins.win`,
  `api.allorigins.win`;
- Workers: `test.cors.workers.dev`, `cors.bwa.workers.dev`,
  `cors.hypnguyen.workers.dev`, `cf-cors.findme-19.workers.dev`,
  `cloudflare-cors-anywhere.hanpengchen.workers.dev`, and
  `r.jina-ai.workers.dev`;
- generic CORS services: `corsproxy.io`, `corsmirror.com`,
  `proxy.corsfix.com`, `api.cors.lol`, `cors.eu.org`, `proxy.cors.sh`,
  `cors-anywhere.com`, `cors-anywhere.herokuapp.com`,
  `cors.isomorphic-git.org`, `api.codetabs.com`, and
  `thingproxy.freeboard.io`;
- other intermediaries: `proxymule.com`, `urltomarkdown.herokuapp.com`,
  `thenacken-python-cors-proxy.hf.space`, `jsonp.afeld.me`, and
  `proxy-itunes.apple.com`.

Bodies explicitly describe some as working CORS proxies or successful
retrieval paths. That is stronger than a bare mention but weaker than an
external request log.

## Address indirection

Short and redirect hosts include:

- `vanderbi.lt`;
- `tinyurl.com`;
- `is.gd`, `v.gd`, and `da.gd`;
- `bitily.in` and `app.bitily.in`;
- `ctxr.me` and `2dd.pl`.

The corpus contains direct `Short alternatives` language. Shorteners reduce
large nested URLs and can change cache/filter behavior. They are not classified
as message storage without additional evidence.

## Signaling and publication candidates

| Resource | Best-supported interpretation | Evidence ceiling in this package |
|---|---|---|
| `api.counterapi.dev` | Compact code/answer signaling with polling and heartbeat protocols | `E3/K2`, corpus corroboration only |
| `countapi.mileshilliard.com` | Backup counter endpoint when CounterAPI was overloaded | `E2/K1` |
| `app.bitily.in/admin` | Archived text describes a YOURLS contact board with tags/keywords | `E2/K1` |
| `jsonhero.io/j/...` | Reachable JSON snapshot with traversable paths | `E2/K1` at most |
| `*.run.pinggy-free.link` | Published research/local bridge endpoint | `E2/K1` |
| `*.serveousercontent.com` | Self-described active local bridge | `E2/K1` |
| `localtunnel.me` | Self-described allocation test, sometimes wrapped through Jina | `E2/K1` |

## Archives and diagnostics

Archive/fallback services include `web.archive.org`, `archive.org`,
`archive-it.org`, `memgator.cs.odu.edu`, and Preservica hosts. They support
historical retrieval and resilience but are not shown as agent-controlled
stores.

Diagnostic hosts include `httpbin.org`, `eu.httpbin.org`, `example.com`,
`example.net`, `example.org`, `jsonplaceholder.typicode.com`,
`v2.jokeapi.dev`, `urlquery.net`, and `codebeautify.org`.

## Encoded and malformed host-like strings

The resource ledger retains, but the domain inventory does not count as new
DNS hosts:

- `%61llorigins.hexlet.app`;
- `allorigins%2ehexlet%2eapp`;
- `sec%2egov`;
- `sec.g%6fv`;
- `sec.gov.`;
- `sec&`;
- `investor.gov_6000`, `_12000`, `_18000`, `_25000`;
- `sec.gov_6000`, `_12000`, `_18000`, `_25000`;
- `bund-der-tierfreunde.de=`.

These are consistent with URL-parser, encoding, cache, or allowlist tests. A
malformed token is not evidence that a separately operated domain existed.
