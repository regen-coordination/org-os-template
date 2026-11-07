// W1's first screens (wizards spec §5.4, "Open an instance"): the answers become the config the
// framework's own clone command takes, and the command is shown, never run by the platform. The
// framework's command is the judge: it is asked, with --dry, whether it accepts what this makes.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { ORG_TYPES, cloneCommand, cloneConfigText, defaultFolder, orgProblem, youProblem } from '../../lib/open-instance.mjs'
import { REAL_REPO } from '../fixtures.ts'

const answers = { start: 'open', name: 'Alder Commons', type: 'LocalNode', description: 'A cooperative of seed keepers in the Alder valley.', language: 'en', license: 'MIT', folder: '../alder-commons', operatorName: 'Ana Costa', email: 'ana@alder.example' }

describe('the config draft', () => {
  it('is the file clone-framework takes: org and operator, nothing the command does not read', () => {
    const c = parse(cloneConfigText(answers)) as Record<string, any>
    expect(c).toEqual({
      org: { name: 'Alder Commons', type: 'LocalNode', short_description: 'A cooperative of seed keepers in the Alder valley.', license: 'MIT' },
      operator: { name: 'Ana Costa', email: 'ana@alder.example' },
    })
  })

  it('carries a language other than English, and leaves English unstated (the command\'s default)', () => {
    expect((parse(cloneConfigText({ ...answers, language: 'pt-BR' })) as any).org.language).toBe('pt-BR')
    expect((parse(cloneConfigText(answers)) as any).org.language).toBeUndefined()
  })

  it('quotes what a person types, so no answer can write anything but its own value', () => {
    const text = cloneConfigText({ ...answers, name: 'Alder: "Commons" # not a comment', description: 'line one\nkey: injected' })
    const c = parse(text) as any
    expect(c.org.name).toBe('Alder: "Commons" # not a comment')
    expect(c.org.short_description).toBe('line one\nkey: injected')
    expect(Object.keys(c)).toEqual(['org', 'operator'])
  })

  it('is accepted by the framework\'s own command, which is asked with --dry and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-instance-'))
    try {
      writeFileSync(join(dir, 'draft.yaml'), cloneConfigText(answers))
      const target = join(dir, 'alder-commons')
      const r = spawnSync(process.execPath, ['scripts/clone-framework.mjs', '--target', target, '--config', join(dir, 'draft.yaml'), '--dry', '--no-git'], { cwd: REAL_REPO, encoding: 'utf8' })
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(r.stdout).toContain('dry-run completed')
      expect(existsSync(target)).toBe(false)
      expect(readdirSync(dir)).toEqual(['draft.yaml'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('and every kind the wizard offers is one the command takes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-instance-kinds-'))
    try {
      for (const { value } of ORG_TYPES) {
        writeFileSync(join(dir, 'draft.yaml'), cloneConfigText({ ...answers, type: value }))
        const r = spawnSync(process.execPath, ['scripts/clone-framework.mjs', '--target', join(dir, 'out'), '--config', join(dir, 'draft.yaml'), '--dry', '--no-git'], { cwd: REAL_REPO, encoding: 'utf8' })
        expect(r.status, `${value}: ${r.stdout}${r.stderr}`).toBe(0)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('the command it shows', () => {
  it('is the framework\'s npm script with a target and a config, and never a force flag', () => {
    expect(cloneCommand(answers, 'draft.yaml')).toBe('npm run clone:framework -- --target ../alder-commons --config draft.yaml')
    expect(cloneCommand({ ...answers, folder: '../a b' }, 'draft.yaml')).toContain("--target '../a b'")
    expect(cloneCommand(answers, 'draft.yaml')).not.toMatch(/--force|--yes|-f\b/)
  })

  it('quotes a folder so no folder can add a second command', () => {
    expect(cloneCommand({ ...answers, folder: "../x'; rm -rf ~; '" }, 'draft.yaml')).toBe("npm run clone:framework -- --target '../x'\\''; rm -rf ~; '\\''' --config draft.yaml")
  })

  it('suggests a folder beside the others from the name', () => {
    expect(defaultFolder('Alder Commons')).toBe('../alder-commons')
    expect(defaultFolder('  Ana & Co.  ')).toBe('../ana-co')
    expect(defaultFolder('???')).toBe('../new-organization')
  })
})

describe('what each step needs before it lets you go on', () => {
  it('asks for a name, a kind, a line, and a folder that is not a path out of reach', () => {
    expect(orgProblem(answers)).toBeNull()
    expect(orgProblem({ ...answers, name: ' ' })).toBe('Write the organization\'s name.')
    expect(orgProblem({ ...answers, type: '' })).toBe('Choose what kind of organization it is.')
    expect(orgProblem({ ...answers, type: 'Wizardry' })).toBe('Choose what kind of organization it is.')
    expect(orgProblem({ ...answers, description: '' })).toBe('Write one line about it.')
    expect(orgProblem({ ...answers, description: 'a\nb' })).toBe('One line means one line.')
    expect(orgProblem({ ...answers, folder: '' })).toBe('Say which folder to make.')
    expect(orgProblem({ ...answers, language: 'zz' })).toBe('Choose a language from the list.')
  })

  it('asks who is setting it up, with an address that is one', () => {
    expect(youProblem(answers)).toBeNull()
    expect(youProblem({ ...answers, operatorName: '' })).toBe('Write your name.')
    expect(youProblem({ ...answers, email: 'ana' })).toBe('Write the email git commits with, like ana@example.org.')
    expect(youProblem({ ...answers, email: 'ana@localhost' })).toBeNull() // git takes it, so the wizard does
  })
})
