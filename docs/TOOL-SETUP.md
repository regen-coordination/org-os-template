# TOOL-SETUP.md — External Tool Configuration

Version: 2.0.0

## Overview

org-os agents can access external systems via MCP (Model Context Protocol) servers. This document covers how to configure each agent runtime to access Notion, GitHub, and other tools.

## Notion MCP Configuration

### Prerequisites
1. A Notion integration token (create at https://www.notion.so/my-integrations)
2. Database IDs for each data registry you want to sync
3. Share relevant Notion pages with the integration

### Claude Code

Add to `.claude/settings.json`:
```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@anthropic/notion-mcp"],
      "env": {
        "NOTION_API_KEY": "secret_..."
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@anthropic/notion-mcp"],
      "env": {
        "NOTION_API_KEY": "secret_..."
      }
    }
  }
}
```

### OpenClaw

Add to `openclaw.config.json`:
```json
{
  "mcp": {
    "servers": {
      "notion": {
        "command": "npx",
        "args": ["-y", "@anthropic/notion-mcp"],
        "env": {
          "NOTION_API_KEY": "secret_..."
        }
      }
    }
  }
}
```

### OpenCode

Add to `.opencode/config.json` (or equivalent):
```json
{
  "mcp": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@anthropic/notion-mcp"],
      "env": {
        "NOTION_API_KEY": "secret_..."
      }
    }
  }
}
```

## TOOLS.md Configuration

Document your Notion workspace in `TOOLS.md`:

```markdown
## Notion
- Workspace: [Workspace Name]
- Integration: [Integration Name]
- Token reference: stored in .env (never commit tokens)

### Database IDs
| Registry | Notion DB ID | Notion DB Name |
|----------|-------------|----------------|
| members.yaml | abc123... | Team Members |
| projects.yaml | def456... | Projects Board |
| meetings.yaml | ghi789... | Meeting Notes |
| finances.yaml | jkl012... | Budget Tracker |
```

## Notion ↔ YAML Sync

### Field Mapping

Define how Notion database columns map to YAML fields. Example for members:

| Notion Column | YAML Field | Type | Notes |
|--------------|-----------|------|-------|
| Name | name | title → string | |
| Role | role | select → string | |
| Status | status | select → string | Map "Active" → "active" |
| Joined | joined | date → ISO 8601 | |
| GitHub | handles.github | text → string | |
| Telegram | handles.telegram | text → string | |

### Sync Direction

- **Notion → YAML**: For day-to-day updates made by team members in Notion
- **YAML → Notion**: For agent-generated updates (meeting processing, schema generation)
- **Conflict resolution**: Timestamp-based. Most recent edit wins. Conflicts flagged in memory/ for review.

### Running Sync

```bash
npm run sync:notion          # Full bidirectional sync
npm run sync:notion:pull     # Notion → YAML only
npm run sync:notion:push     # YAML → Notion only
```

## GitHub MCP

For agents that need to manage GitHub issues, PRs, and repos:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/github-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

## Other External Tools

### Google Drive / Docs
Reference in TOOLS.md with shared folder URLs. Access via Google MCP server or direct API.

### Telegram Bot
For chat interface. See `docs/CHAT-INTERFACE.md` for bot configuration.

### Safe (Treasury)
For on-chain transaction queuing. Document Safe address and chain in IDENTITY.md. Access via Safe API.

## Security Notes

- **Never commit API tokens** to the repository
- Store tokens in `.env` (add `.env` to `.gitignore`)
- Use environment variable references in MCP configs
- Document token locations in TOOLS.md without exposing values
- Rotate tokens periodically

---

_Part of org-os v2.0.0 — see [OPERATOR-GUIDE.md](OPERATOR-GUIDE.md) for the non-tech operator manual._
