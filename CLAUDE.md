@AGENTS.md

## Claude Code

Só a mecânica desta ferramenta; as regras do projeto estão no arquivo importado
acima.

- **Alto risco:** nos caminhos que o AGENTS.md marca como alto risco — migrations,
  cálculo de aderência, autenticação e a camada de IA — use plan mode antes de
  editar.
- **Referência de estrutura** (aliases de path, rotas, schema do banco) fica em
  `docs/ARQUITETURA.md`, não aqui: é consulta, não regra.
- **Camada 2 sem Docker:** o daemon não sobe em sandbox de sessão remota. Rode a
  Camada 1 e declare no relatório que a 2 ficou por executar — não tente
  contornar com mock de banco.
