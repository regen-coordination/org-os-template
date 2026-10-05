# {{ org.name }}{{#if org.tagline }} — {{ org.tagline }}{{/if}}

> {{ org.short_description }}

**Tipo:** {{ org.type }} · **Versão do framework:** {{ org.framework_version }} · **Situação:** {{ org.status }}

---

## O que é isto

`{{ org.name }}` é uma instância do org-os — um sistema operacional para {{ org.network_purpose }}. Roda sobre o [framework org-os]({{ framework.url }}) e se conecta a outras instâncias da mesma rede.

## Por onde ir

- **Quem opera a instância:** `GETTING-STARTED.md` → primeiros passos
- **Agentes:** `AGENTS.md` → como conduzir uma sessão
- **Identidade:** `IDENTITY.md`, `SOUL.md`, `MASTERPLAN.md`
- **Trabalho em andamento:** `HEARTBEAT.md`, `memory/`, `data/projects.yaml`
- **Documentação:** a do framework fica em {{ framework.url }}/docs (em inglês)

## Quem é você?

### Você é uma **pessoa que opera a instância**

Rode `/initialize` (ou `npm run initialize`) para ver o painel do dia: projetos ativos, tarefas, agenda, financiamento, contexto recente. Ao terminar, encerre com `/close`.

Na primeira vez, prepare o ambiente:

```bash
git clone <este-repositorio> && cd <pasta>
npm install
npm run install:hooks
```

### Você é um **agente**

1. Leia `MASTERPLAN.md` para saber qual é o mandato
2. Leia `SOUL.md` para conhecer os valores e o tom de voz
3. Rode `/initialize` para carregar o estado completo
4. **Nunca rode `git stash` neste repositório** — veja [VAULT-SAFETY.md](docs/VAULT-SAFETY.md)

### Você **contribui ou é de uma organização parceira**

Veja em `federation.yaml` as relações de confiança e as integrações. Para falar com a gente, use os canais listados em `data/channels.yaml`.

---

## Identidade

{{ identity.body }}

## Mapa dos sistemas

{{#if systems_map}}
{{ systems_map }}
{{/if}}

## Como atualizar a partir do framework

```bash
# Manual (hoje)
git pull upstream main
npm run migrate
npm run sync:packages
npm run validate:structure

# Automático (previsto no framework)
npm run sync:upstream
```

{{> federation }}

## Documentação

A maior parte da documentação fica no repositório do framework, em inglês: [{{ framework.url }}/docs]({{ framework.url }}/docs). O que for específico desta instância fica na pasta `docs/` daqui.

## Requisitos

- Node ≥22
- npm ≥10.9.2
- git

## Licença

{{ org.license }}
