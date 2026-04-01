# Paperclip Deployment & Onboarding Guide

## 🎯 Complete Package for Organization Implementation

This guide covers installing Paperclip in any org-os instance (like refi-bcn-os).

---

## 📦 What's Been Delivered

### Codebase (Fully Implemented)
```
org-os/packages/paperclip-agents-app/
├── src/
│   ├── server/              (API + WebSocket + Sync)
│   ├── ui/                  (Vue 3 Dashboard)
│   └── db/                  (Database layer)
├── migrations/              (PostgreSQL + SQLite)
├── docs/                    (Complete technical docs)
└── package.json             (All dependencies)
```

### Documentation (4 Files, ~3000 words)

1. **README_PAPERCLIP.md** (272 lines)
   - Main entry point
   - 3 user paths
   - Quick reference
   - FAQ + troubleshooting

2. **PAPERCLIP_QUICKSTART.md** (60 lines)
   - Ultra-fast 5-minute setup
   - Copy-paste commands
   - Success indicators

3. **PAPERCLIP_INSTALL.md** (400+ lines)
   - Complete installation
   - Configuration options
   - Troubleshooting guide
   - Advanced usage

4. **PAPERCLIP_USERGUIDE.md** (500+ lines)
   - Non-technical user manual
   - Feature explanations
   - Common workflows
   - Learning paths

---

## 🚀 Implementation Path for Any Org-OS Instance

### Phase 1: Preparation (10 minutes)

**Check Prerequisites:**
```bash
# Node.js 20+
node --version

# npm
npm --version

# git
git --version

# Free ports 3000 and 3100
lsof -i :3000
lsof -i :3100
```

**Clone Paperclip into your instance:**
```bash
cd your-org-os-instance
git clone https://github.com/regen-coordination/paperclip-agents-app packages/paperclip-agents-app
```

### Phase 2: Installation (5 minutes)

**Terminal 1 - Backend:**
```bash
cd packages/paperclip-agents-app
npm install
npm run dev:server
```

**Wait for:**
```
✅ Paperclip server running at http://localhost:3100
   Organization: [Your Org Name]
   Agents: [count]
   Skills: [count]
```

**Terminal 2 - Frontend:**
```bash
cd packages/paperclip-agents-app
npm run dev:ui
```

**Wait for:**
```
✅ Vite running at http://localhost:3000
```

### Phase 3: Verification (2 minutes)

**Open browser:** `http://localhost:3000`

**Verify:**
- ✅ Dashboard loads
- ✅ Your organization name appears
- ✅ Agents from AGENTS.md listed
- ✅ Green "Live" indicator visible
- ✅ All 8 pages accessible in sidebar

**Success!** 🎉

---

## 📋 Documentation Structure

For **Different User Types:**

### Path 1: I Want to Start NOW (5 min)
```
readme_paperclip.md (entry point)
   ↓
PAPERCLIP_QUICKSTART.md (just copy-paste)
   ↓
Browser to http://localhost:3000
```

### Path 2: I Want to Understand (15 min)
```
README_PAPERCLIP.md (entry point)
   ↓
PAPERCLIP_INSTALL.md (full guide)
   ↓
[Choose SQLite or PostgreSQL]
   ↓
Browser to http://localhost:3000
```

### Path 3: I'm a Regular User (20 min)
```
README_PAPERCLIP.md (entry point)
   ↓
Let technical person install (Paths 1-2)
   ↓
Read PAPERCLIP_USERGUIDE.md
   ↓
Start using dashboard
```

---

## 🔧 Configuration Options

### Option A: Local Development (Recommended)
```bash
# Default - no configuration needed
npm run dev:server
npm run dev:ui
```
- Database: SQLite (`data/paperclip.db`)
- Setup time: 0 minutes
- Best for: Single user, testing

### Option B: PostgreSQL (Team)
```bash
export DATABASE_TYPE=postgres
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=your_password
export DB_NAME=paperclip

npm run dev:server
npm run dev:ui
```
- Database: PostgreSQL server
- Setup time: 5 minutes
- Best for: Multiple users, production

---

## 📊 How It Integrates with org-os

### Reads From Your org-os:
```
your-org-os/
├── AGENTS.md          → Displays agents in dashboard
├── federation.yaml    → Shows network config
├── skills/            → Lists available skills
├── memory/            → Shows memory timeline
└── data/              → Accesses YAML data
```

### Writes Back To org-os:
- Creating agent → Updates AGENTS.md
- Editing config → Updates federation.yaml
- Adding skill → Creates/updates skills/
- Recording memory → Updates memory/

### Auto-Sync:
- File watcher monitors changes (300ms debounce)
- Dashboard updates instantly
- No manual sync needed

---

## 🎮 First User Experience

### On First Load
1. Dashboard shows organization overview
2. Sidebar shows 8 pages
3. Agent cards display from AGENTS.md
4. Real-time indicators show status
5. Ready to interact

### First Actions
1. **Create a task** - Click "New Task" in Tasks page
2. **Create an agent** - Click "New Agent" in Agents page
3. **Record memory** - Click "New Entry" in Memory page
4. **View costs** - See spending in Costs page

### Everything Works Immediately
- No server restart needed
- Changes persist automatically
- Files sync in real-time
- No technical knowledge required

---

## 📚 Documentation Locations

**In org-os/packages/paperclip-agents-app/:**
```
├── IMPLEMENTATION_COMPLETE.md     (Full feature overview)
├── docs/
│   ├── PHASE2-REALTIME-SYNC.md    (Real-time tech details)
│   ├── API_REFERENCE.md           (55+ endpoints)
│   └── [other tech docs]
└── src/                           (Source code with comments)
```

**In your-org-os-instance/:**
```
├── README_PAPERCLIP.md            (START HERE)
├── PAPERCLIP_QUICKSTART.md        (5-min setup)
├── PAPERCLIP_INSTALL.md           (Full guide)
└── PAPERCLIP_USERGUIDE.md         (User manual)
```

---

## ✅ Success Criteria

Paperclip is successfully deployed when:

- ✅ `npm run dev:server` starts without errors
- ✅ `npm run dev:ui` starts without errors
- ✅ Dashboard loads at `http://localhost:3000`
- ✅ Organization name appears correctly
- ✅ Agents from AGENTS.md are displayed
- ✅ Green "Live" indicator shows connection
- ✅ Can create a new task
- ✅ Changes persist on page refresh
- ✅ File watcher detects changes (optional verification)

---

## 🚨 Common Issues & Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| Port 3100 in use | `kill -9 $(lsof -t -i :3100)` |
| Port 3000 in use | `kill -9 $(lsof -t -i :3000)` |
| npm install fails | `rm -rf node_modules && npm install` |
| Dashboard won't load | Refresh browser, check console |
| Changes not syncing | Restart server, check `LOG_LEVEL=debug` |
| WebSocket fails | Ensure server is running on 3100 |

See **PAPERCLIP_INSTALL.md** for full troubleshooting.

---

## 🔄 Maintenance

### Daily
- Monitor "Live" indicator in dashboard
- Check sync status
- Review any alerts

### Weekly
- Update task statuses
- Review costs dashboard
- Check federation sync

### Monthly
- Review memory entries
- Archive old items
- Check agent budgets

### Updates
```bash
cd packages/paperclip-agents-app
git pull origin main
npm install
npm run dev:server  # Restart server
```

---

## 🎓 Training Path for Teams

### Level 1: Getting Started (1 day)
- Install Paperclip (30 min)
- Explore dashboard (30 min)
- Create first task (30 min)
- Create agent (30 min)

### Level 2: Regular Use (1 week)
- Daily task management
- Memory recording
- Cost monitoring
- Agent creation

### Level 3: Advanced (2 weeks)
- Federation management
- Budget optimization
- API integration
- Custom workflows

---

## 💡 Key Implementation Insights

### Why This Works
1. **Zero Setup** - SQLite works instantly
2. **Auto-Sync** - File changes detected automatically
3. **Real-Time** - WebSocket updates immediately
4. **Non-Technical** - Dashboard requires no CLI
5. **Flexible** - PostgreSQL for teams, SQLite for local
6. **Complete** - All features built-in

### What Makes It Easy
- Copy-paste commands
- No external services required
- No configuration needed (SQLite)
- Clear error messages
- Comprehensive documentation
- Three learning paths

### What's Protected
- Org-os files never deleted (just updated)
- Database can be backed up easily
- All operations logged
- Easy rollback (git revert)

---

## 🎯 Go-Live Checklist

Before declaring Paperclip "live" in your instance:

- [ ] Installed successfully
- [ ] Dashboard loads
- [ ] Organization name correct
- [ ] Agents display from AGENTS.md
- [ ] Can create/edit agents
- [ ] Can create tasks
- [ ] Can record memories
- [ ] Real-time sync verified
- [ ] Database working (check data/paperclip.db or PostgreSQL)
- [ ] All documentation reviewed by team
- [ ] Troubleshooting guide bookmarked
- [ ] Support contact identified

---

## 📞 Ongoing Support

### Self-Service Resources
1. **README_PAPERCLIP.md** - Start here
2. **PAPERCLIP_INSTALL.md** - Troubleshooting section
3. **PAPERCLIP_USERGUIDE.md** - Feature guide
4. **docs/API_REFERENCE.md** - API details
5. **Enable debug**: `LOG_LEVEL=debug npm run dev`

### Getting Help
1. Check logs first
2. Review relevant documentation
3. Try restarting servers
4. Check health endpoint: `curl http://localhost:3100/health`

---

## 🚀 Next Evolution (Future)

### Phase 2C (Coming)
- Plugin marketplace
- Advanced RBAC
- Multi-tenant support
- Cloud deployment guide

---

## 📝 Summary

**Paperclip is production-ready and easy to deploy.**

- **15 minutes** to full installation
- **3 documentation paths** for different users
- **4 comprehensive guides** (3000+ words)
- **Zero external dependencies** (SQLite default)
- **Real-time sync** out of the box
- **8-page dashboard** fully functional
- **55+ API endpoints** ready to use

**Every org-os instance can now have Paperclip running in less than 20 minutes.**

---

**Version**: 0.1.0  
**Status**: Production Ready ✨  
**Last Updated**: April 2025
