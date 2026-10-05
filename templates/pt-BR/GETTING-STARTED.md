# Primeiros passos com {{ org.name }}

{{#if org.tagline }}
> {{ org.tagline }}
{{/if}}

Em uns 30 minutos você se situa por aqui. A maior parte é leitura; o resto é rodar um comando e ver o painel aparecer.

---

## 1. Conheça a organização (5 min)

Leia nesta ordem:

1. **`SOUL.md`** — missão, tom de voz, valores
2. **`IDENTITY.md`** — o que somos e o que não somos
3. **`MASTERPLAN.md`** — o que está em andamento e as prioridades

Esses três arquivos explicam *por que* este repositório existe.

## 2. Abra a sua primeira sessão (5 min)

```bash
/initialize
```

(No Claude Code, no Zed ou em qualquer cliente que aceite comandos de barra. No terminal, rode `npm run initialize`.)

O painel mostra: projetos ativos, tarefas, a agenda da semana, planos, prazos de financiamento, contexto recente, a situação da rede e uma pergunta: no que você quer trabalhar?

## 3. Encontre o seu lugar (10 min)

Passe os olhos por:

- `data/members.yaml` — quem está aqui e o que faz
- `data/projects.yaml` — o que está ativo e quem puxa cada projeto
- `HEARTBEAT.md` — o que precisa de atenção agora

Escolha algo que te chame. Decida por onde vai começar.

## 4. Faça a sua primeira contribuição (10 min)

Algumas possibilidades:

- Escrever uma entrada de memória: `memory/{{ today }}.md`
- Organizar as anotações de uma reunião: use a skill `meeting-processor`
- Revisar as oportunidades de financiamento: use a skill `funding-scout`
- Atualizar um projeto: edite `data/projects.yaml` e depois rode `npm run generate:schemas`

{{#if org.is_hub}}
Como **hub** do org-os, esta instância também acompanha as instâncias que derivam dela. `npm run analyze:instances` mostra o quanto cada uma se distanciou; `npm run check:divergence` mostra as diferenças nos scripts.

{{/if}}## 5. Encerre direito

```bash
/close
```

Isso escreve a memória do dia, atualiza o `HEARTBEAT.md`, faz o commit e o push (depois de passar pelas verificações de segurança dos arquivos).

---

## Se você travar

- **Segurança dos arquivos:** antes de qualquer operação do git que mexa nos arquivos de trabalho, rode `npm run vault:snapshot -- "<motivo>"`. Veja [docs/VAULT-SAFETY.md](docs/VAULT-SAFETY.md).
- **Uma skill não aparece:** rode `/skills` para listar tudo o que foi encontrado, com os problemas detectados.
- **As validações falham:** rode `npm run validate:structure` para a estrutura e `npm run validate:schemas` para os esquemas.
- **Qualquer outra coisa:** consulte a documentação do framework em {{ framework.url }}/docs (em inglês).

## E agora?

Você já sabe se virar por aqui. Escolha um projeto em `data/projects.yaml`, abra uma sessão e comece a contribuir.

{{> cheatsheet }}
