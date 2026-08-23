@AGENTS.md

## Claude Code

Só a mecânica desta ferramenta; as regras do projeto estão no arquivo importado
acima.

- **Alto risco:** nos caminhos que o AGENTS.md marca como alto risco — migrations,
  cálculo de aderência, autenticação e a camada de IA — use plan mode antes de
  editar.
- **Referência de estrutura** (aliases de path, rotas, schema do banco) fica em
  `docs/ARQUITETURA.md`, não aqui: é consulta, não regra.
- **Camadas 2 e 3 sem Docker:** o daemon não sobe em sandbox de sessão remota, e
  isso **não tem conserto**. Rode a Camada 1 e declare no relatório quais ficaram
  por executar — não tente contornar com mock de banco nem com servidor local no
  lugar da imagem.
- **A Camada 3 leva minutos.** `docker compose up --build` reconstrói a imagem.
  Antes de rodá-la, confirme que não vai derrubar uma stack que o usuário esteja
  usando.
