# CLAUDE.md — Instruções do Claude Code para {{ org.name }}

Este repositório é **{{ org.name }}**, uma instância do org-os: o sistema operacional de uma organização. Roda sobre o framework org-os ({{ framework.url }}) e recebe de lá as atualizações do framework; o framework em si é desenvolvido no repositório dele, não aqui.
{{#if org.short_description }}
> {{ org.short_description }}
{{/if}}
{{> language }}
## Para começar

**Leia `MASTERPLAN.md` primeiro.** É lá que estão o mandato, as frentes ativas e as prioridades desta organização.

Depois siga a sequência de início descrita em `AGENTS.md`:

1. `SOUL.md` — valores, missão, tom de voz, limites
2. `IDENTITY.md` — quem é esta organização
3. `USER.md` — perfil de quem opera a instância
4. `MEMORY.md` — decisões principais, contexto atual
5. `memory/YYYY-MM-DD.md` — o registro diário mais recente
6. `HEARTBEAT.md` — tarefas ativas (veja o que é urgente)
7. `TOOLS.md` — endpoints, endereços, canais
8. `federation.yaml` — as outras instâncias da rede e o upstream

Uma instância nova começa quase vazia. Se `data/*.yaml` e `SOUL.md` ainda estiverem só com o texto inicial, siga a sequência de `BOOTSTRAP.md` antes de qualquer outra coisa.

## Regras principais

- **Escopo:** as operações desta organização. Mudanças no framework são propostas no repositório do framework, não aqui.
- **Fonte da verdade:** `data/*.yaml` para os dados estruturados; `DECISIONS.md` para o que foi decidido e por quê (`MEMORY.md` serve de índice).
- **Depois de mudar os dados:** rode `npm run generate:schemas && npm run validate:schemas` e inclua no mesmo commit os `.well-known/*.json` gerados.
- **Memória:** escreva o registro do dia em `memory/YYYY-MM-DD.md` (acrescente; nunca sobrescreva).
- **Planos:** os estratégicos ficam em `docs/plans/` (com índice em `docs/plans/QUEUE.md`); os táticos, em `docs/superpowers/plans/`.
- **Cuidado com ações externas:** para mensagens, publicações e transações on-chain, prepare o rascunho e apresente. Nunca envie sem aprovação.
- **Segurança dos arquivos:** nunca rode `git stash`, `git clean` nem `git reset --hard` aqui. Veja `docs/VAULT-SAFETY.md`.

## Começo e fim de sessão

Use `/initialize` para começar uma sessão (mostra o painel e carrega o contexto) e `/close` para encerrar (escreve a memória, faz o commit e, quando houver um remote do git configurado, o push — uma instância nova ainda não tem). Os dois comandos estão definidos em `.claude/commands/`.

**Opcional: acesso a APIs.** Copie `.env.example` para `.env` e preencha só as chaves que você usa. O `.env` está no `.gitignore`; nunca faça commit dele.

## Tarefas comuns

```bash
npm run initialize         # Reúne o estado da organização (--format=markdown para o painel)
npm run generate:schemas   # Gera de novo os esquemas EIP-4824 a partir de data/*.yaml
npm run validate:schemas   # Valida os esquemas
npm run validate:structure # Confere esta instância com a especificação do framework
npm run selftest           # Roda todas as validações e os testes
npm run sync:upstream      # Traz as atualizações do framework para esta instância
npm run knowledge          # Compila a base de conhecimento, o índice e as verificações
```

## Documentos principais

Os documentos em `docs/` vêm do framework e estão em inglês.

- `GETTING-STARTED.md` — primeiros passos para quem opera esta instância
- `AGENTS.md` — como os agentes trabalham aqui
- `docs/FILE-STRUCTURE.md` — a estrutura de pastas
- `docs/DATA-MODEL.md` — os registros em `data/`
- `docs/FEDERATION.md` — como esta instância se conecta às outras
- `docs/OPERATOR-GUIDE.md` — manual não técnico para quem opera
