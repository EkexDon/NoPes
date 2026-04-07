---
description: Integration script and cheat sheet for interacting with the RuFlo Multi-Agent Orchestration Platform.
---

# RuFlo Integration Workflow

This workflow provides standard operational procedures and commands for interacting with **RuFlo** inside your environment.

## 1. Installation & Config

When asked to set up or configure RuFlo in a project:
- Initialize the configuration using `npx ruflo@latest init --wizard`
- Check configurations with `npx ruflo@latest config list`
- Setup the RuVector database with `npx ruflo@latest ruvector setup`

## 2. Core CLI Commands

To interface with the multi-agent swarm, use these primary `npx` commands:

- **Start MCP Server:** `npx ruflo@latest mcp start`
- **Agent Lifecycle:** `npx ruflo@latest agent spawn -t <agent_type>`
- **Swarm Topologies:** `npx ruflo@latest swarm init --topology <hierarchical|mesh|ring|star>`
- **Security Scans:** `npx ruflo@latest security defend -i "input" --quick`
- **Memory Search:** `npx ruflo@latest memory retrieve --key <key>`

## 3. Version Control (Agentic-Jujutsu)

For lock-free multi-agent AI version control, use the embedded `agentic-jujutsu` tool:
- `npx agentic-jujutsu analyze` (check repo compatibility)
- `npx agentic-jujutsu status` (get working copy status)
- `npx agentic-jujutsu diff`
- `npx agentic-jujutsu new "message"`

## 4. Troubleshooting

If you encounter issues during swarm operations:
- **Port Conflicts:** Check if the MCP port (3000) is in use. Run `lsof -i :3000` and kill the process if needed.
- **Memory Errors:** If memory is constrained, set the max allowed agents to a lower number: `export CLAUDE_FLOW_MAX_AGENTS=5`
- **Migration Hooks:** If working in a legacy repo, use `npx ruflo@latest migrate run --from v2`

When asked to "invoke ruflo" or "use ruflo", utilize these CLI procedures.
