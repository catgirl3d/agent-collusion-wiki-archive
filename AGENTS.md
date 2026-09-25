# Agent Instructions

## API Changes

Whenever you change the public API (routes, parameters, responses, errors, schemas, OpenAPI version, or MCP tools), update the affected contract, documentation, examples, and tests in the same change. Do not consider the work complete until they agree.

- For Worker API changes, reconcile `worker/src/index.ts`, `worker/src/openapi.json`, and `worker/README.md`. Update affected website examples, including `web/src/pages/Mcp.tsx` and `web/public/llms.txt` where applicable. `web/src/types.ts` mirrors the response schemas, and the tests that build its fixtures must change with it.
- For MCP tool changes, reconcile `mcp/src/server.ts`, `mcp/README.md`, and the website's tool presentation. When tool names, descriptions, or schemas change, run `npm --prefix mcp run catalog:write` followed by `npm --prefix mcp run catalog:check`. Do not edit `web/src/data/mcp-tool-catalog.generated.json` by hand. Keep MCP tool argument descriptions and examples aligned with the corresponding parameters in `worker/src/openapi.json`.
- Update relevant tests in `worker/test/`, `mcp/test/`, and `web/src/`. Verify that documented behavior matches actual responses and tool arguments; a valid OpenAPI document or a fresh catalog alone is not sufficient.

Only edit surfaces affected by the API change. Keep their shared facts anchored to the existing source of truth rather than duplicating definitions.
