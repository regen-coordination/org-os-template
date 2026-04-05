#!/usr/bin/env node

/**
 * Generate all EIP-4824 compliant schemas from operational data
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read federation.yaml to get base URL
const federationPath = path.join(rootDir, 'federation.yaml');
const federationContent = fs.readFileSync(federationPath, 'utf-8');
const baseUrlMatch = federationContent.match(/daoURI: "https:\/\/([^"]+)"/);
const baseUrl = baseUrlMatch ? baseUrlMatch[1] : 'org.example.com';

// Read dao.json to get organization info
const daoJsonPath = path.join(rootDir, '.well-known', 'dao.json');
let daoJson = {};
if (fs.existsSync(daoJsonPath)) {
  daoJson = JSON.parse(fs.readFileSync(daoJsonPath, 'utf-8'));
}

console.log('Generating EIP-4824 schemas...');

// Generate members.json
function generateMembers() {
  const membersPath = path.join(rootDir, 'data', 'members.yaml');
  if (!fs.existsSync(membersPath)) {
    return;
  }

  const membersData = yaml.load(fs.readFileSync(membersPath, 'utf-8'));
  const members = (membersData?.members || []).map(m => ({
    id: m.id
  }));

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "DAO",
    "members": members
  };

  const outputPath = path.join(rootDir, '.well-known', 'members.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log('✓ Generated members.json');
}

// Generate meetings.json
function generateMeetings() {
  const meetingsDir = path.join(rootDir, 'content', 'meetings');
  if (!fs.existsSync(meetingsDir)) {
    return;
  }

  const meetings = [];
  const files = fs.readdirSync(meetingsDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(meetingsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(content);

    if (!data.id) continue;

    // Extract action items from content
    const actionItems = [];
    const actionItemRegex = /- \[ \] (.+?)(?: \(@(\w+), due: (\d{4}-\d{2}-\d{2})\))?(?: #(\w+))?/g;
    let match;
    while ((match = actionItemRegex.exec(content)) !== null) {
      actionItems.push({
        id: match[4] || `action-${actionItems.length + 1}`,
        description: match[1],
        assignee: match[2] || null,
        status: "pending",
        dueDate: match[3] || null
      });
    }

    // Extract decisions
    const decisions = [];
    const decisionRegex = /- \[ \] (.+?)(?: #(\w+))?/g;
    const decisionsSection = content.match(/## Decisions\s+([\s\S]*?)(?=##|$)/);
    if (decisionsSection) {
      let decisionMatch;
      while ((decisionMatch = decisionRegex.exec(decisionsSection[1])) !== null) {
        decisions.push({
          id: decisionMatch[2] || `decision-${decisions.length + 1}`,
          description: decisionMatch[1],
          consensus: false
        });
      }
    }

    meetings.push({
      id: data.id,
      type: data.type || "meeting",
      title: data.title || file.replace('.md', ''),
      date: data.date || new Date().toISOString(),
      participants: data.participants || [],
      status: data.status || "planned",
      agenda: `https://${baseUrl}/meetings/${data.id}#agenda`,
      notes: `https://${baseUrl}/meetings/${data.id}`,
      decisions: decisions,
      actionItems: actionItems
    });
  }

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "MeetingRegistry",
    "meetings": meetings
  };

  const outputPath = path.join(rootDir, '.well-known', 'meetings.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated meetings.json (${meetings.length} meetings)`);
}

// Generate projects.json
function generateProjects() {
  const projectsDir = path.join(rootDir, 'content', 'projects');
  const projectsYamlPath = path.join(rootDir, 'data', 'projects.yaml');
  
  const projects = [];

  // Read from YAML file
  if (fs.existsSync(projectsYamlPath)) {
    const projectsData = yaml.load(fs.readFileSync(projectsYamlPath, 'utf-8'));
    if (projectsData?.projects) {
      projects.push(...projectsData.projects);
    }
  }

  // Read from markdown files
  if (fs.existsSync(projectsDir)) {
    const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'));
    
    for (const file of files) {
      const filePath = path.join(projectsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(content);

      if (!data.id) continue;

      // Extract tasks
      const tasks = [];
      const taskRegex = /- \[ \] (.+?)(?: \(@(\w+)\))?(?: #(\w+))?/g;
      let taskMatch;
      while ((taskMatch = taskRegex.exec(content)) !== null) {
        tasks.push({
          id: taskMatch[3] || `task-${tasks.length + 1}`,
          description: taskMatch[1],
          assignee: taskMatch[2] || null,
          status: "todo",
          priority: "medium"
        });
      }

      // Extract milestones
      const milestones = [];
      const milestoneRegex = /- \[ \] (.+?) \(due: (\d{4}-\d{2}-\d{2})\)(?: #(\w+))?/g;
      const milestonesSection = content.match(/### Milestones\s+([\s\S]*?)(?=###|$)/);
      if (milestonesSection) {
        let milestoneMatch;
        while ((milestoneMatch = milestoneRegex.exec(milestonesSection[1])) !== null) {
          milestones.push({
            id: milestoneMatch[3] || `milestone-${milestones.length + 1}`,
            title: milestoneMatch[1],
            status: "pending",
            dueDate: milestoneMatch[2]
          });
        }
      }

      projects.push({
        id: data.id,
        type: data.type || "project",
        name: data.name || file.replace('.md', ''),
        description: data.description || '',
        status: data.status || "Integrate",
        lead: data.lead || null,
        members: data.members || [],
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        milestones: milestones,
        tasks: tasks,
        budget: data.budget || null,
        relatedProposals: data.relatedProposals || []
      });
    }
  }

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "ProjectRegistry",
    "projects": projects
  };

  const outputPath = path.join(rootDir, '.well-known', 'projects.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated projects.json (${projects.length} projects)`);
}

// Generate finances.json
function generateFinances() {
  const financesPath = path.join(rootDir, 'data', 'finances.yaml');
  if (!fs.existsSync(financesPath)) {
    return;
  }

  const financesData = yaml.load(fs.readFileSync(financesPath, 'utf-8'));

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "FinancialRegistry",
    "budgets": financesData?.budgets || [],
    "expenses": financesData?.expenses || [],
    "revenues": financesData?.revenues || []
  };

  const outputPath = path.join(rootDir, '.well-known', 'finances.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated finances.json`);
}

// Generate proposals.json from governance.yaml
function generateProposals() {
  const govPath = path.join(rootDir, 'data', 'governance.yaml');
  let decisions = [];

  if (fs.existsSync(govPath)) {
    const govData = yaml.load(fs.readFileSync(govPath, 'utf-8'));
    decisions = (govData?.governance?.decisions || []).map(d => ({
      id: d.id,
      title: d.title,
      type: d.type || "proposal",
      status: d.status || "draft",
      date: d.date || null,
      summary: d.summary || ""
    }));
  }

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "ProposalRegistry",
    "proposals": decisions
  };

  const outputPath = path.join(rootDir, '.well-known', 'proposals.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated proposals.json (${decisions.length} proposals)`);
}

// Generate activities.json (from meetings + recent memory)
function generateActivities() {
  const activities = [];

  // Pull from meetings
  const meetingsPath = path.join(rootDir, 'data', 'meetings.yaml');
  if (fs.existsSync(meetingsPath)) {
    const meetingsData = yaml.load(fs.readFileSync(meetingsPath, 'utf-8'));
    for (const m of (meetingsData?.meetings || []).slice(-20)) {
      activities.push({
        id: m.id,
        type: "meeting",
        title: m.title || m.id,
        date: m.date,
        summary: m.summary || null
      });
    }
  }

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "ActivityLog",
    "activities": activities
  };

  const outputPath = path.join(rootDir, '.well-known', 'activities.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated activities.json (${activities.length} activities)`);
}

// Generate contracts.json from IDENTITY.md
function generateContracts() {
  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "ContractRegistry",
    "contracts": []
  };

  // Try to extract contract addresses from federation.yaml
  if (fs.existsSync(federationPath)) {
    const fed = yaml.load(federationContent);
    const id = fed?.identity || {};
    if (id.safe) {
      schema.contracts.push({
        type: "safe",
        address: id.safe,
        chain: id.chain || null
      });
    }
    if (id.gardens) {
      schema.contracts.push({
        type: "gardens",
        address: id.gardens,
        chain: id.chain || null
      });
    }
  }

  const outputPath = path.join(rootDir, '.well-known', 'contracts.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated contracts.json (${schema.contracts.length} contracts)`);
}

// Generate ideas.json from data/ideas.yaml (v2)
function generateIdeas() {
  const ideasPath = path.join(rootDir, 'data', 'ideas.yaml');
  if (!fs.existsSync(ideasPath)) return;

  const ideasData = yaml.load(fs.readFileSync(ideasPath, 'utf-8'));
  const ideas = (ideasData?.ideas || []).map(i => ({
    id: i.id,
    title: i.title,
    status: i.status || "proposed",
    submitted_by: i.submitted_by || null,
    champions: i.champions || [],
    ecosystem_gap: i.ecosystem_gap || null,
    description: i.description || "",
    hatched_repo: i.hatched_repo || null,
    skills_needed: i.skills_needed || [],
    created: i.created || null,
    votes: i.votes || 0
  }));

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "IdeaRegistry",
    "ideas": ideas
  };

  const outputPath = path.join(rootDir, '.well-known', 'ideas.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated ideas.json (${ideas.length} ideas)`);
}

// Generate knowledge.json from data/knowledge-manifest.yaml (v2)
function generateKnowledge() {
  const manifestPath = path.join(rootDir, 'data', 'knowledge-manifest.yaml');
  if (!fs.existsSync(manifestPath)) return;

  const manifestData = yaml.load(fs.readFileSync(manifestPath, 'utf-8'));
  const km = manifestData?.knowledge_manifest || {};

  const schema = {
    "@context": "https://www.daostar.org/schemas",
    "type": "KnowledgeManifest",
    "domains": (km.domains || []).map(d => ({
      id: d.id,
      name: d.name,
      description: d.description || "",
      coverage: d.coverage || "none",
      page_count: d.page_count || 0,
      sources: d.sources || [],
      last_updated: d.last_updated || null
    })),
    "exchange": {
      published_domains: km.exchange?.published_domains || [],
      subscribed_domains: km.exchange?.subscribed_domains || []
    }
  };

  const outputPath = path.join(rootDir, '.well-known', 'knowledge.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated knowledge.json (${schema.domains.length} domains)`);
}

// Generate events.json from data/events.yaml (v2)
function generateEvents() {
  const eventsPath = path.join(rootDir, 'data', 'events.yaml');
  if (!fs.existsSync(eventsPath)) return;

  const eventsData = yaml.load(fs.readFileSync(eventsPath, 'utf-8'));
  const events = (eventsData?.events || []).map(e => ({
    id: e.id,
    title: e.title,
    type: e.type || "event",
    date: e.date,
    end_date: e.end_date || null,
    location: e.location || null,
    status: e.status || "upcoming",
    related_project: e.related_project || null
  }));

  // Not written to .well-known/ (not EIP-4824), but available for dashboard
  console.log(`✓ Processed events.yaml (${events.length} events)`);
}

// Run all generators
try {
  generateMembers();
  generateMeetings();
  generateProjects();
  generateFinances();
  generateProposals();
  generateActivities();
  generateContracts();
  generateIdeas();
  generateKnowledge();
  generateEvents();

  console.log('\n✓ All schemas generated successfully!');
} catch (error) {
  console.error('Error generating schemas:', error);
  process.exit(1);
}
