# CHAT-INTERFACE.md — Telegram & Chat Bot Interface Spec

Version: 2.0.0

## Overview

org-os agents can interact with community members via chat interfaces (Telegram, web chat). This enables non-technical operators to query organizational data, submit ideas, and get status updates without using GitHub or CLI.

## Interface Contract

### What the Chat Agent Can Do

**Read operations (always available):**
- Answer questions about active projects (`data/projects.yaml`)
- Report member roles and contact info (`data/members.yaml`)
- Summarize recent meetings (`data/meetings.yaml`)
- List upcoming events (`data/events.yaml`)
- Show governance status (`data/governance.yaml`)
- Report financial summaries (`data/finances.yaml`)
- List open funding opportunities (`data/funding-opportunities.yaml`)
- Show federation peers (`federation.yaml`)

**Write operations (with confirmation):**
- Submit new ideas → creates entry in `data/ideas.yaml`
- Log meeting notes → creates entry in `data/meetings.yaml`
- Update project status → modifies `data/projects.yaml`
- Add action items → updates `HEARTBEAT.md`

**Never via chat (requires CLI/GitHub):**
- Modify SOUL.md, IDENTITY.md, federation.yaml
- Execute financial transactions
- Change governance structure
- Deploy or modify skills

### Example Interactions

```
User: What are our active projects?
Bot: You have 5 active projects:
1. Local Node Onboarding Program (lead: Luiz, status: executing)
2. Stewardship Transition (lead: Monty, status: developing)
...

User: I have an idea for a regenerative agriculture toolkit
Bot: Great! Let me capture that. Can you tell me:
- What ecosystem gap does this address?
- Who would champion this idea?
I'll add it to the ideation board for community review.

User: What happened in the last meeting?
Bot: The last meeting was on March 28 (Weekly Stewards Sync):
- Discussed Q2 budget allocation
- Decided to proceed with council election timeline
- Action items: Luiz to draft voter materials by April 5

User: How much is in our treasury?
Bot: Current treasury balance (last updated March 1):
- Primary Safe (Optimism): ~$45,000 USD equivalent
- Q1 expenses: $12,500
- See full details in the dashboard: [URL]
```

## Telegram Bot Setup

### Bot Configuration

1. Create a Telegram bot via @BotFather
2. Get the bot token
3. Add to TOOLS.md:
```markdown
## Telegram
- Bot: @[YourOrgBot]
- Token reference: stored in .env as TELEGRAM_BOT_TOKEN
- Main group: [group URL]
- Admin channel: [channel URL]
```

### Bot Persona

Define the bot's personality in agent modes (`.claude/agents/telegram-bot.md`):

```yaml
---
name: telegram-bot
description: Community-facing chat interface
activation: "When interacting via Telegram"
---

# Telegram Bot Mode

## Voice
- Friendly and concise
- Use plain language (no technical jargon)
- Be helpful but don't over-promise
- Direct people to the dashboard for detailed views

## Boundaries
- Read-only by default
- Confirm before writing any data
- Never share private member info in public channels
- Redirect sensitive topics to private messages
```

### Privacy Rules

- **Public channels**: Only share public data (project names, event dates, general status)
- **Private messages**: Can share member-specific data (their tasks, their roles)
- **Admin channels**: Can share financial details, governance decisions
- **Never share**: API tokens, wallet private keys, personal contact info

## Web Chat (Future)

A web-based chat interface can be embedded in the dashboard or hosted separately. The same interface contract applies. Implementation options:

- Embedded widget in `packages/dashboard/`
- Standalone chat page
- Integration with existing chat platforms (Intercom, Crisp, etc.)

## Data Flow

```
User message (Telegram/Web)
    ↓
Chat Agent reads data/*.yaml
    ↓
Agent formulates response
    ↓
Response sent back to user
    ↓
If write operation: Agent updates data/*.yaml
    ↓
Agent logs interaction in memory/YYYY-MM-DD.md
```

## Rate Limiting & Safety

- Rate limit: Max 10 messages per user per minute
- Write operations require explicit confirmation
- Admin actions require admin role verification
- All interactions logged in memory/

---

_Part of org-os v2.0.0 — see [OPERATOR-GUIDE.md](OPERATOR-GUIDE.md) for the non-tech operator manual._
