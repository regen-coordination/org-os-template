## Federação

Esta organização ({{ org.type }}) faz parte da rede **{{ federation.network }}**.

{{#if federation.peers}}
**Outras instâncias da rede:**
{{#each federation.peers}}
- {{ this }}
{{/each}}
{{/if}}

Veja em `federation.yaml` quem está na rede, o nível de confiança com cada instância e as integrações. Como o protocolo funciona está em `docs/FEDERATION.md` (documento do framework, em inglês).
