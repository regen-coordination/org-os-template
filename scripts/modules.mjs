#!/usr/bin/env node

/**
 * modules.mjs — org-os module engine (v5, Phase 1)
 *
 * The SOLE reader/writer of module state:
 *   modules/x/module.yaml     — framework registry source
 *   data/modules.yaml         — instance install manifest
 *   .well-known/modules.json  — published state
 *
 * Commands: list | add <id> [--from <framework-path>] | adopt [--from <path>] | registry
 * Phase 2/3 commands (update, status, check) are specified in
 * docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

export const REQUIRED_FIELDS = ['id', 'version', 'type', 'description'];
export const MODULE_TYPES = ['core', 'operational', 'integration'];

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  for (const f of REQUIRED_FIELDS) if (!m[f]) errors.push(`missing required field: ${f}`);
  if (m.id && !/^org-os-[a-z0-9-]+$/.test(m.id)) errors.push(`invalid id: ${m.id}`);
  if (m.version && !/^\d+\.\d+\.\d+$/.test(m.version)) errors.push(`invalid version: ${m.version}`);
  if (m.type && !MODULE_TYPES.includes(m.type)) errors.push(`invalid type: ${m.type}`);
  for (const key of ['files', 'templates']) {
    if (m[key] && (typeof m[key] !== 'object' || Array.isArray(m[key])))
      errors.push(`${key} must be a map of source → target paths`);
  }
  if (m.dependencies && !Array.isArray(m.dependencies)) errors.push('dependencies must be a list');
  return errors;
}
