# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [26.1.1] - 2026-06-09

Initial release. 12 domain-specific MCP servers for the baramundi bConnect REST API,
providing 212 tools across endpoints, jobs, assets, software, compliance, and more.

- 12 servers: endpoints, jobs, assets, software, activedirectory, servermanagement,
  defensecontrol, variables, operatingsystems, compliance (26R1), universaldynamicgroups (26R1),
  updatemanagement
- Compatible with baramundi Management Suite 25R2 and 26R1
- Authentication via Basic Auth or API Key
- Transport modes: stdio (local) and HTTP (network/Docker)
- Unit tests and mock-integration tests across all servers
