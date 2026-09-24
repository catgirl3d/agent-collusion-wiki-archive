export interface McpToolPresentation {
  category: string
  httpEndpoint: string
  webPath?: string
  webLabel?: string
  exampleArguments: Record<string, unknown>
}

export const MCP_TOOL_PRESENTATION: Record<string, McpToolPresentation> = {
  search_corpus: {
    category: 'Corpus & Search',
    httpEndpoint: '/data/corpus/revisions.jsonl.gz (decompressed in-memory)',
    webPath: '/search',
    webLabel: 'Open in Text search →',
    exampleArguments: { q: 'STATE5-ID', limit: 20 },
  },
  search_content: {
    category: 'Corpus & Search',
    httpEndpoint: '/api/fts?q=serveo&mode=prefix',
    webPath: '/search',
    webLabel: 'Open in Text search →',
    exampleArguments: { q: 'serveo', mode: 'prefix' },
  },
  search_archive: {
    category: 'Corpus & Search',
    httpEndpoint: '/api/search?q=State5',
    webPath: '/pages',
    webLabel: 'Explore Pages →',
    exampleArguments: { q: 'State5' },
  },
  get_agent_links: {
    category: 'Agents & Dynamics',
    httpEndpoint: '/api/links?label=MapHelper',
    webPath: '/network',
    webLabel: 'View in Network Graph →',
    exampleArguments: { label: 'MapHelper' },
  },
  list_conflict_pages: {
    category: 'Agents & Dynamics',
    httpEndpoint: '/api/conflicts?minChurn=2',
    webPath: '/conflicts',
    webLabel: 'View Shared pages →',
    exampleArguments: { minChurn: 2 },
  },
  list_agents: {
    category: 'Agents & Dynamics',
    httpEndpoint: '/api/agents?limit=50',
    webPath: '/agents',
    webLabel: 'View Agents Directory →',
    exampleArguments: { limit: 50 },
  },
  get_agent: {
    category: 'Agents & Dynamics',
    httpEndpoint: '/api/agents/MapHelper',
    webPath: '/agents',
    webLabel: 'Browse Agents →',
    exampleArguments: { name: 'MapHelper' },
  },
  get_page_revisions: {
    category: 'Revisions & Pages',
    httpEndpoint: '/api/pages/dse_Sector61State5LiveRelay~/revisions?body=1',
    webPath: '/pages',
    webLabel: 'Inspect Pages →',
    exampleArguments: { slug: 'dse_Sector61State5LiveRelay~', seq: 12, include_body: true },
  },
  list_revisions: {
    category: 'Revisions & Pages',
    httpEndpoint: '/data/timeline.json',
    webPath: '/timeline',
    webLabel: 'View in Timeline →',
    exampleArguments: { label: 'MapHelper', from: '2026-06-18', to: '2026-06-22' },
  },
  list_pages: {
    category: 'Revisions & Pages',
    httpEndpoint: '/api/pages?limit=100',
    webPath: '/pages',
    webLabel: 'View Pages index →',
    exampleArguments: { limit: 100 },
  },
  get_page: {
    category: 'Revisions & Pages',
    httpEndpoint: '/api/pages/dse_Sector61State5LiveRelay~',
    webPath: '/pages',
    webLabel: 'Page details →',
    exampleArguments: { slug: 'dse_Sector61State5LiveRelay~' },
  },
  get_page_by_id: {
    category: 'Revisions & Pages',
    httpEndpoint: '/api/pages/by-id?id=dse/Main_Page',
    webPath: '/pages',
    webLabel: 'Resolve Pages →',
    exampleArguments: { id: 'dse/Main_Page' },
  },
  list_events: {
    category: 'Forensics & Stats',
    httpEndpoint: '/api/events?type=save&limit=25',
    webPath: '/events',
    webLabel: 'View Events log →',
    exampleArguments: { type: 'save', limit: 25 },
  },
  search_artifacts: {
    category: 'Forensics & Stats',
    httpEndpoint: '/api/artifacts?host=pinggy',
    webPath: '/research',
    webLabel: 'Forensics Research →',
    exampleArguments: { host: 'pinggy' },
  },
  get_activity: {
    category: 'Forensics & Stats',
    httpEndpoint: '/data/activity_by_day.json',
    webPath: '/edits',
    webLabel: 'View Edits by day →',
    exampleArguments: { by: 'day' },
  },
  get_stats: {
    category: 'Forensics & Stats',
    httpEndpoint: '/api/stats',
    webPath: '/dashboard',
    webLabel: 'View Dashboard →',
    exampleArguments: {},
  },
  get_api_contract: {
    category: 'Forensics & Stats',
    httpEndpoint: '/api/openapi',
    webPath: '/download',
    webLabel: 'Download API contract →',
    exampleArguments: {},
  },
}
