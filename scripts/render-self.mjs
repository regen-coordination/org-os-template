#!/usr/bin/env node
import fs from 'node:fs';
import yaml from 'js-yaml';
import { execSync } from 'node:child_process';
import { render } from '../templates/render.mjs';

function loadInitState() {
  return JSON.parse(execSync('node scripts/initialize.mjs', { encoding: 'utf-8' }));
}

const state = loadInitState();
const fed = yaml.load(fs.readFileSync('federation.yaml', 'utf-8'));

const ctx = {
  org: {
    name: state.identity.name,
    type: state.identity.type,
    emoji: state.identity.emoji,
    short_description: state.identity.mission?.split('.')[0] + '.',
    tagline: null,
  },
  federation: {
    network: state.federation.network,
    role: state.federation.role || 'framework + orchestration hub',
    upstream: 'self (framework root)',
    framework_version: '3.5',
    peers: state.federation.peers?.map(p => p.name) || [],
    downstream: state.instances?.map(i => `${i.name} (${i.id})`) || [],
  },
  instances: state.instances || [],
  skills: {
    canonical_count: state.skills?.length || 0,
    canonical_list: state.skills?.map(s => s.name).join(', ') || '',
    candidate_count: state.skillCandidates?.length || 0,
  },
  packages: {
    canonical_count: 0,  // populated from packages-matrix
    canonical_list: '',
    candidate_count: 0,
  },
  isFramework: true,
  isCooperative: false, isDAO: false, isLocalNode: false, isProject: true, isHub: true,
  showCalendar: false,
  showFunding: false,
  today: new Date().toISOString().slice(0, 10),
  license: 'MIT',
};

// Populate packages
const pm = yaml.load(fs.readFileSync('data/packages-matrix.yaml', 'utf-8'));
const canonicalPkgs = (pm.packages || []).filter(p => p.in_framework);
const candidatePkgs = (pm.packages || []).filter(p => p.promotion_status === 'candidate' || p.promotion_status === 'ready');
ctx.packages.canonical_count = canonicalPkgs.length;
ctx.packages.canonical_list = canonicalPkgs.map(p => p.id).join(', ');
ctx.packages.candidate_count = candidatePkgs.length;

const readmeTmpl = fs.readFileSync('templates/README.framework.md', 'utf-8');
fs.writeFileSync('README.md', render(readmeTmpl, ctx));

const gsTmpl = fs.readFileSync('templates/GETTING-STARTED.md', 'utf-8');
fs.writeFileSync('GETTING-STARTED.md', render(gsTmpl, ctx));

console.log('Rendered: README.md, GETTING-STARTED.md');
