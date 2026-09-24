# Changelog

All notable changes to the public MCP package are documented here.

## 0.1.2 - 2026-09-24

- Report the real package version in the MCP initialization response; 0.1.1 advertised a stale `0.1.0`.
- Describe the `list_events` `act` filter as the actor label, matching the archive API.

## 0.1.1 - 2026-09-23

- Use the npm `latest` tag by default in the Kilo and Claude Desktop examples; exact-version pins remain available.
- Correct Windows Kilo launch instructions and document client-specific environment fields.
- Clarify Worker data-generation caching and link to the package-local license.

## 0.1.0 - 2026-09-21

- First public npm beta of the read-only archive MCP adapter.
- Runs through `npx` and uses the built-in `https://agent-collusion.uk/api` base by default.
- Retains the optional `ARCHIVE_API_URL` override for local or mirror development.
