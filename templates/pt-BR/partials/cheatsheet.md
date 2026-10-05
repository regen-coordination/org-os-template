## Comandos do dia a dia

| Comando | Para que serve |
|---|---|
| `npm run initialize` | Abre uma sessão (sincroniza, mostra o painel, ajuda a planejar) |
| `/initialize` (Claude Code / Zed / OpenCode) | A mesma coisa, pelo comando de barra |
| `/close` | Encerra: escreve a memória, faz o commit e o push |
| `npm run validate:structure` | Confere a instância com a especificação do framework |
| `npm run validate:schemas` | Valida os esquemas EIP-4824 e os de identidade |
| `npm run analyze:instances` | Relatório de diferenças entre instâncias (só no framework) |
| `npm run selftest` | Roda todas as verificações de uma vez |
| `npm run vault:snapshot -- "<motivo>"` | Guarda o estado atual dos arquivos em refs/snapshots/ antes de qualquer operação arriscada no git |
| `npm run vault:audit` | Confirma que nada se perdeu desde o último snapshot |
| `npm run check:divergence` | Compara os scripts da instância com os do framework |
| `/skills` | Lista as skills do repositório, do usuário e dos plugins |
