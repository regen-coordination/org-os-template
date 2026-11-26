# TOOL-SETUP.md — External Tool Configuration

org-os reaches external systems in three ways: environment variables read by its own scripts, the agent host's own MCP (Model Context Protocol) configuration, and vendored CLI skills. This page says which is built, how to set each up, and where a thing is not built.

## Credentials

- Secrets live in `.env` at the repository root. `.env` and `.env*.local` are in `.gitignore`.
- `.env.example` lists the variables the framework reads: `NOTION_API_KEY`, and for the optional modules `BUZZ_RELAY_URL`, `BUZZ_CHANNEL`, `BUZZ_PRIVATE_KEY`, `BUZZ_CLI_BIN`, `PAPER_MCP_URL`, `PAPER_FILE_ID`. Copy it: `cp .env.example .env`.
- `scripts/initialize.mjs` loads `.env` itself (through `dotenv`).
- `TOOLS.md` records where things are (endpoints, channel ids, database ids, which env var holds which token). It never holds a token.

## Notion

### Dashboard read (built)

If `NOTION_API_KEY` is set and `TOOLS.md` contains database ids, `npm run initialize` (and `initialize:markdown`) reads those Notion databases through `@notionhq/client` and merges projects, meetings and members into the dashboard. Without a key it prints `[info] NOTION_API_KEY not set` on stderr and uses local YAML only.

To set it up:

1. Create an integration at https://www.notion.so/my-integrations and share the databases with it.
2. Put the key in `.env` as `NOTION_API_KEY`.
3. In `TOOLS.md`, add lines in this form (the script matches `Projects:`, `Meetings:` and `Members:` followed by a 32-character id, case-insensitive):

```markdown
### Database IDs

- Projects: [32-char-database-id]
- Meetings: [32-char-database-id]
- Members: [32-char-database-id]
```

Only these three databases are read, and only to display them. Nothing is written to Notion.

### Notion to YAML sync (not built)

An earlier version of this page described `npm run sync:notion`, `sync:notion:pull` and `sync:notion:push`, a field-mapping table and timestamp-based conflict resolution. None of those scripts exist in `package.json` or `scripts/`. The registries in `data/*.yaml` remain the source of truth and are edited as files.

### Notion CLI (vendored skill)

`skills/notion-cli/SKILL.md` is a vendored skill for Notion's `ntn` command-line client. It authenticates with `NOTION_API_TOKEN` (a different variable from the one `initialize` reads) or `ntn login`.

### Notion over MCP (host configuration, not verified)

Agent hosts that support MCP can be given a Notion server so the agent queries Notion directly. This repository ships no MCP server configuration for Notion and no code depends on it. The server package name, its environment variable and the config file each host reads change over time, so this page does not reproduce them: follow Notion's and your host's current documentation. What this repository keeps per host:

| Host | Config in this repository |
|---|---|
| Claude Code | `.claude/settings.json` (the git-safety guard hook and deny rules; no MCP servers) |
| Cursor | `.cursor/commands/` (slash commands only) |
| opencode | `.opencode/opencode.json` (loads `AGENTS.md` and `skills/*/SKILL.md` as instructions) |

## GitHub

No GitHub MCP server is configured in this repository. Agents use `git` and, where installed, the `gh` CLI.

## Other tools

- **Google Drive / Docs:** record shared-folder URLs in `TOOLS.md`. No Google integration code ships.
- **Telegram:** [CHAT-INTERFACE.md](CHAT-INTERFACE.md) is a specification for a chat-bot interface. This page does not claim a bot is built.
- **Safe (treasury):** put the Safe address and chain in the `Treasury` section of `IDENTITY.md`; the `capital-flow` skill reads the Safe Transaction Service endpoint from `TOOLS.md`.
- **Optional modules** (Buzz, Paper, Cloudflare OS, and others): see [Modules](MODULES.md).

## Security notes

- Never commit tokens. `.env` is ignored; keep it that way.
- Reference tokens by variable name in `TOOLS.md`, never by value.
- Rotate tokens periodically.

---

_See [OPERATOR-GUIDE.md](OPERATOR-GUIDE.md) for the non-tech operator manual._
