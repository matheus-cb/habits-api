import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(__dirname, '..', '..');

/**
 * INV-37 — toda variável que a aplicação LÊ chega ao container.
 *
 * ## O defeito que produziu isto
 *
 * `ASSISTANT_DAILY_OUTPUT_TOKENS`, `ASSISTANT_MAX_TURNS` e
 * `ASSISTANT_ACTION_TTL_MINUTES` foram para o `.env`, para o `.env.example` e para
 * o Zod — e **não** para o `docker-compose.yml`. Na imagem elas não existiam, e o
 * Zod caía nos defaults.
 *
 * O sintoma é o pior tipo: quem apertasse o teto diário para conter custo veria o
 * número novo no arquivo e o comportamento antigo no container, sem nada
 * acusando. Não é erro, é divergência silenciosa entre o que se configura e o que
 * roda.
 *
 * ## Por que isto não é o mesmo que a checagem 9
 *
 * A checagem 9 compara os comandos `npm` do CI com o `verify.sh` — duas listas
 * descrevendo a mesma execução. Aqui são duas listas descrevendo a mesma
 * CONFIGURAÇÃO: o que a aplicação lê, e o que o container entrega. Mesma forma,
 * outro par.
 */
function envDoZod(): string[] {
  const fonte = fs.readFileSync(path.join(RAIZ, 'src', 'config', 'env.ts'), 'utf8');
  const dentroDoSchema = fonte.slice(fonte.indexOf('z.object('), fonte.lastIndexOf('});'));

  // Chaves em MAIÚSCULA no início da linha: é a forma que toda variável de
  // ambiente tem, e a única. Comentário e prosa não casam.
  return [...dentroDoSchema.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
}

/**
 * Percorre LINHA POR LINHA em vez de fatiar o texto.
 *
 * A primeira versão fatiava de `environment:` até o próximo `\n    ` — e casava
 * com um comentário indentado dentro do próprio bloco, cortando a lista na
 * terceira variável. O gate reprovou dizendo que doze variáveis faltavam no
 * compose, quando o defeito era o extrator.
 *
 * É o caso vizinho do gate pegando o gate: sem o caso que exige um mínimo de
 * entradas, essa lista curta teria produzido um relatório de doze defeitos
 * inexistentes — e eu teria "consertado" o compose que já estava certo.
 */
function envDoCompose(): string[] {
  const linhas = fs
    .readFileSync(path.join(RAIZ, 'docker-compose.yml'), 'utf8')
    .split('\n');

  const inicioDoApi = linhas.findIndex((linha) => linha === '  api:');
  const inicioDoAmbiente = linhas.findIndex(
    (linha, i) => i > inicioDoApi && linha.trim() === 'environment:'
  );

  const chaves: string[] = [];
  for (let i = inicioDoAmbiente + 1; i < linhas.length; i += 1) {
    const linha = linhas[i]!;
    if (linha.trim() === '' || linha.trimStart().startsWith('#')) continue;

    // Indentação menor que a das variáveis (6 espaços) encerra o bloco.
    const indentacao = linha.length - linha.trimStart().length;
    if (indentacao < 6) break;

    const casou = /^([A-Z][A-Z0-9_]+):/.exec(linha.trim());
    if (casou) chaves.push(casou[1]!);
  }

  return chaves;
}

/**
 * Lidas pela aplicação e deliberadamente NÃO passadas ao container.
 *
 * Cada uma com o motivo, porque exceção sem motivo é whitelist, e whitelist
 * apodrece — foi o critério aplicado à exceção de INV-02 e vale aqui.
 */
const FORA_DO_CONTAINER: Record<string, string> = {
  PORT: 'o container publica a porta pelo `ports:`; o processo escuta na do compose',
  DATABASE_URL_READONLY_PLACEHOLDER: 'nunca existiu — entrada de exemplo do próprio teste',
};

describe('INV-37 — a configuração da aplicação chega ao container', () => {
  it('INV-37: os extratores acham as duas listas — vazias não provam nada', () => {
    // O caso vizinho do próprio gate. Um regex que devolvesse lista vazia faria a
    // comparação abaixo passar sem examinar nada, que é a forma mais silenciosa
    // deste padrão.
    const zod = envDoZod();
    const compose = envDoCompose();

    expect(zod.length).toBeGreaterThanOrEqual(8);
    expect(compose.length).toBeGreaterThanOrEqual(6);
    expect(zod).toContain('DATABASE_URL');
    expect(zod).toContain('JWT_SECRET');
    expect(compose).toContain('DATABASE_URL');
  });

  it('INV-37: adversário — nenhuma variável lida pela aplicação falta no compose', () => {
    const ausentes = envDoZod().filter(
      (chave) => !envDoCompose().includes(chave) && !(chave in FORA_DO_CONTAINER)
    );

    // A mensagem carrega o nome porque quem quebrar isto precisa acrescentar a
    // linha no compose ou declarar o motivo em `FORA_DO_CONTAINER` — e as duas
    // saídas são legítimas.
    expect(ausentes).toEqual([]);
  });

  it('INV-37: adversário — variável nova no Zod e ausente do compose REPROVA', () => {
    // Constrói o caso que o gate deveria pegar, sem editar arquivo: simula uma
    // chave nova e confere que a comparação a acusa.
    const zodComNova = [...envDoZod(), 'ASSISTANT_TETO_INVENTADO'];
    const ausentes = zodComNova.filter(
      (chave) => !envDoCompose().includes(chave) && !(chave in FORA_DO_CONTAINER)
    );

    expect(ausentes).toEqual(['ASSISTANT_TETO_INVENTADO']);
  });

  it('INV-37: toda exceção declarada tem motivo escrito', () => {
    for (const [chave, motivo] of Object.entries(FORA_DO_CONTAINER)) {
      expect(motivo.length).toBeGreaterThan(15);
      expect(chave).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it('INV-37: os defaults do compose não CONTRADIZEM os do Zod', () => {
    // Um default diferente nos dois lugares é pior que default só num: o
    // comportamento muda entre rodar local e rodar na imagem, e os dois parecem
    // configurados. Confere os que têm default nos dois.
    const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.yml'), 'utf8');
    const zod = fs.readFileSync(path.join(RAIZ, 'src', 'config', 'env.ts'), 'utf8');

    // Os pares são explícitos, e não derivados, porque o valor no Zod pode ter
    // separador de milhar e o do YAML não pode. Derivar exigiria normalizar os
    // dois lados, e a normalização é onde a comparação erraria em silêncio.
    //
    // Este caso pegou uma contradição minha na primeira execução: o default do Zod
    // para `AI_TIMEOUT_MS` é 20.000 e eu escrevi 12.000 no compose. O efeito seria
    // o assistente esperar 12s local e 20s na imagem, com os dois números
    // parecendo configurados.
    const pares: [string, string][] = [
      ['ASSISTANT_DAILY_OUTPUT_TOKENS', '120_000'],
      ['ASSISTANT_MAX_TURNS', '10'],
      ['ASSISTANT_ACTION_TTL_MINUTES', '30'],
      ['ANTHROPIC_MODEL', 'claude-opus-5'],
      ['ASSISTANT_MODEL', 'claude-sonnet-5'],
      ['AI_TIMEOUT_MS', '20_000'],
      ['AI_MAX_OUTPUT_TOKENS', '1024'],
    ];

    for (const [chave, valorNoZod] of pares) {
      // Duas normalizações, e as duas são necessárias:
      //  - o Zod pode ter separador de milhar (`120_000`); o YAML não pode
      //  - default de string vem entre aspas (`default('claude-opus-5')`); de
      //    número não vem. Aceitar as duas formas é o que faz a conferência
      //    valer para os dois tipos.
      const semSeparador = valorNoZod.replace(/_/g, '');
      const escapado = valorNoZod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      expect(zod).toContain(`${chave}: z.`);
      expect(zod).toMatch(new RegExp(`default\\('?${escapado}'?\\)`));
      expect(compose).toContain(`\${${chave}:-${semSeparador}}`);
    }
  });
});
