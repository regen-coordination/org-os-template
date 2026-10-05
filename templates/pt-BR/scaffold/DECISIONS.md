# DECISIONS.md — Registro das decisões importantes

_Registro das decisões significativas de {{ org.name }}. Só se acrescenta; nada é apagado. As mais recentes ficam no topo. As notas detalhadas de cada sessão ficam em `memory/YYYY-MM-DD.md`. Este arquivo é a **referência oficial** do agente para saber "o que foi decidido e por quê" — `MEMORY.md` serve de índice; `DECISIONS.md` guarda o registro._

## Convenções

Cada decisão é uma seção com estes campos:

- **Status** — `active` (em vigor) · `superseded` (substituída por uma decisão posterior) · `withdrawn` (revertida) · `proposed` (em discussão, ainda não ratificada)
- **Escopo** — a que área(s) se refere: identidade / governança / federação / modelo de dados / ambiente dos agentes / publicação / etc.
- **Decisão** — o que foi decidido, em uma ou duas frases
- **Por quê** — o motivo, incluindo as alternativas consideradas e por que foram descartadas
- **Refs** — commits, arquivos, planos, decisões relacionadas, memória de sessão

Quando uma decisão for substituída, marque-a como `superseded` e acrescente um link `Substituída por:` para a decisão mais nova. Não apague: o valor está no histórico.

---

## {{ today }} · Instância criada a partir do org-os {{ framework.major_minor }}

- **Status:** active
- **Escopo:** identidade
- **Decisão** — {{ org.name }} foi gerada a partir do framework org-os (v{{ framework.version }}) com o `clone-framework`; a origem está registrada em `federation.yaml.metadata`.
- **Por quê** — um único caminho de configuração, sem atalhos; a instância começa com os seus próprios registros, memória e fila de planos vazios, sem nada do framework.
- **Refs** — `federation.yaml`, `docs/plans/QUEUE.md`
