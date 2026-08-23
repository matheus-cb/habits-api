/**
 * Imprime a configuração do servidor MCP para colar no Claude Code.
 *
 * A ponte que faltava. As primitivas existiam, o endpoint respondia, e conectar
 * exigia saber que o transporte é Streamable HTTP, que a autenticação é o mesmo
 * Bearer das rotas, e obter um token à mão com `curl`. Três coisas que ninguém
 * lembra em três semanas.
 *
 * ## Por que ele IMPRIME em vez de escrever o arquivo
 *
 * O `.mcp.json` fica na raiz de quem consome, que é fora deste repositório — e o
 * token é credencial. Um script que grava credencial num arquivo que talvez seja
 * versionado é como segredo vaza. Imprimir deixa a decisão de onde guardar com
 * quem sabe onde é seguro.
 *
 *   npm run mcp:config -- alguem@example.com senha123
 */
import { env } from '@/config/env';

const [email, senha] = process.argv.slice(2);

if (!email || !senha) {
  console.error('uso: npm run mcp:config -- <email> <senha>');
  console.error('a conta precisa existir; use a mesma do dashboard.');
  process.exit(2);
}

const base = `http://localhost:${env.PORT}`;

async function principal() {
  const resposta = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    console.error(`login falhou (${resposta.status}): ${corpo}`);
    console.error(`a stack está de pé? \`curl ${base}/health\``);
    process.exit(1);
  }

  const { data } = (await resposta.json()) as { data: { accessToken: string } };

  // O nome `habits` é o que aparece em `/mcp` no Claude Code. `headers` carrega o
  // Bearer porque este transporte não tem fluxo de OAuth: a identidade é a mesma
  // das rotas HTTP (INV-10), e é isso que fecha o escopo do usuário.
  const config = {
    mcpServers: {
      habits: {
        type: 'http',
        url: `${base}/mcp`,
        headers: { Authorization: `Bearer ${data.accessToken}` },
      },
    },
  };

  console.log(JSON.stringify(config, null, 2));
  console.error('');
  console.error('Cole isto no `.mcp.json` do projeto onde você usa o Claude Code,');
  console.error('ou rode:');
  console.error('');
  console.error(
    `  claude mcp add-json habits '${JSON.stringify(config.mcpServers.habits)}'`
  );
  console.error('');
  console.error('O token expira — rode de novo quando o servidor devolver 401.');
}

void principal();
