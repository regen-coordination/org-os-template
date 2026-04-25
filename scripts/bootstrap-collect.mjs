#!/usr/bin/env node
import { intro, outro, text, multiselect, isCancel, cancel } from '@clack/prompts';
import fs from 'node:fs';
import yaml from 'js-yaml';

const PACKAGE_OPTIONS = [
  { value: 'dashboard', label: 'dashboard — visual org overview' },
  { value: 'operations', label: 'operations — operational layer' },
  { value: 'webapps', label: 'webapps — shared webapp scaffolding' },
  { value: 'regen-agents', label: 'regen-agents — operational agents' },
  { value: 'paperclip-agents-app', label: 'paperclip-agents-app — agent control variant' },
  { value: 'opal-bridge', label: 'opal-bridge — meeting/transcript processing' },
  { value: 'koi-bridge', label: 'koi-bridge — KOI-net integration' },
  { value: 'agents-app', label: 'agents-app — agent control app' },
  { value: 'egregore-core', label: 'egregore-core — collective intelligence' },
];

const SKILL_OPTIONS = [
  'bootstrap-interviewer', 'capital-flow', 'funding-scout', 'heartbeat-monitor',
  'idea-scout', 'knowledge-curator', 'meeting-processor', 'org-os-init',
  'schema-generator', 'workspace-improver',
];

export async function collectInteractive(orgType) {
  intro('org-os bootstrap');
  const name = await text({ message: 'Organization name:', placeholder: 'Bread Cooperative' });
  if (isCancel(name)) { cancel(); process.exit(1); }
  const description = await text({ message: 'Short description (one sentence):' });
  if (isCancel(description)) { cancel(); process.exit(1); }
  const emoji = await text({ message: 'Emoji:', placeholder: '🥖' });
  if (isCancel(emoji)) { cancel(); process.exit(1); }
  const operatorGithub = await text({ message: 'Operator GitHub handle:', placeholder: 'luizfernandosg' });
  if (isCancel(operatorGithub)) { cancel(); process.exit(1); }

  const packages = await multiselect({
    message: 'Select packages to enable:',
    options: PACKAGE_OPTIONS,
    initialValues: ['dashboard', 'operations'],
    required: false,
  });
  if (isCancel(packages)) { cancel(); process.exit(1); }

  const skillOptOuts = await multiselect({
    message: 'Skills to OPT OUT of (default: all enabled):',
    options: SKILL_OPTIONS.map(s => ({ value: s, label: s })),
    initialValues: [],
    required: false,
  });
  if (isCancel(skillOptOuts)) { cancel(); process.exit(1); }

  const enabledSkills = SKILL_OPTIONS.filter(s => !skillOptOuts.includes(s));

  const network = await text({ message: 'Federation network (or leave blank for standalone):', placeholder: 'regen-coordination' });
  if (isCancel(network)) { cancel(); process.exit(1); }

  outro('Captured.');

  return {
    identity: { name, type: orgType, emoji, short_description: description },
    members: [{ github: operatorGithub, role: 'maintainer', layer: null }],
    channels: [],
    federation: { network: network || null, upstream: '../org-os', framework_version: '3.5' },
    packages: Object.fromEntries(PACKAGE_OPTIONS.map(p => [p.value, packages.includes(p.value)])),
    skills: { enabled: enabledSkills },
    knowledge_sources: [],
  };
}

export function collectFromConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(raw);
}
