// scripts/crew/roles.mjs
//
// Roles and circles: the crew's seats, read from roles/. Pure apart from reading
// files under the root it is given. See docs/superpowers/specs/2026-10-10-org-os-crew-design.md §4.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';

/** A refusal meant for the operator: one plain sentence, printed without a stack. */
export class CrewError extends Error {}

// The kinds `herdr agent start --kind` accepts (herdr 0.9.1).
export const AGENT_KINDS = [
  'pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline', 'omp', 'mastracode',
  'opencode', 'copilot', 'kimi', 'kiro', 'droid', 'amp', 'grok', 'hermes', 'kilo', 'qodercli',
  'qwen', 'letta', 'maki', 'muse',
];

// herdr agent names are [a-z][a-z0-9_-]{0,31}; four characters are kept back for a
// "-NN" suffix when a seat is already taken.
export const ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,27}$/;
export const DEFAULT_MAX_AGENTS = 4;

export function loadCircles(rootDir) {
  const path = join(rootDir, 'roles', 'circles.yaml');
  if (!existsSync(path)) {
    throw new CrewError(`This repository has no crew roles: ${path} does not exist.`);
  }
  const doc = yaml.load(readFileSync(path, 'utf-8')) || {};
  const circles = Array.isArray(doc.circles) ? doc.circles : [];
  const maxAgents = doc.max_agents ?? DEFAULT_MAX_AGENTS;
  if (!Number.isInteger(maxAgents) || maxAgents < 1) {
    throw new CrewError(`roles/circles.yaml: max_agents must be a whole number of 1 or more, not ${JSON.stringify(doc.max_agents)}.`);
  }
  return { circles, circleIds: circles.map((c) => c.id), maxAgents };
}

export function validateRole(data, { fileId, circleIds }) {
  const errors = [];
  if (typeof data.id !== 'string' || !ROLE_ID_PATTERN.test(data.id)) {
    errors.push('id must be lowercase letters, digits, "-" or "_", starting with a letter, at most 28 characters');
  } else if (data.id !== fileId) {
    errors.push(`id "${data.id}" does not match the file name "${fileId}.md"`);
  }
  if (!circleIds.includes(data.circle)) {
    errors.push(`circle "${data.circle}" is not in roles/circles.yaml (${circleIds.join(', ')})`);
  }
  if (!AGENT_KINDS.includes(data.kind)) {
    errors.push(`kind "${data.kind}" is not an agent kind herdr can start`);
  }
  if (typeof data.may_seat !== 'boolean') errors.push('may_seat must be true or false');
  if (data.model !== undefined && (typeof data.model !== 'string' || data.model === '')) {
    errors.push('model, when given, must be a non-empty string');
  }
  if (data.skills !== undefined && !(Array.isArray(data.skills) && data.skills.every((s) => typeof s === 'string'))) {
    errors.push('skills, when given, must be a list of skill names');
  }
  return errors;
}

export function listRoleIds(rootDir) {
  const dir = join(rootDir, 'roles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.slice(0, -3))
    .sort();
}

export function loadRole(rootDir, id) {
  const { circleIds } = loadCircles(rootDir);
  const path = join(rootDir, 'roles', `${id}.md`);
  if (!ROLE_ID_PATTERN.test(String(id)) || !existsSync(path)) {
    throw new CrewError(`No role "${id}". Roles available: ${listRoleIds(rootDir).join(', ') || 'none'}.`);
  }
  let data;
  try {
    // The empty options object bypasses gray-matter's content cache.
    ({ data } = matter(readFileSync(path, 'utf-8'), {}));
  } catch (err) {
    throw new CrewError(`roles/${id}.md is not a valid role: its frontmatter could not be read (${err.message}).`);
  }
  const errors = validateRole(data, { fileId: id, circleIds });
  if (errors.length > 0) {
    throw new CrewError(`roles/${id}.md is not a valid role: ${errors.join('; ')}.`);
  }
  return {
    id: data.id,
    circle: data.circle,
    kind: data.kind,
    model: data.model ?? null,
    may_seat: data.may_seat,
    skills: data.skills ?? [],
    path,
  };
}
