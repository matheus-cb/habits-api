import fs from 'node:fs';
import path from 'node:path';
import { CONSTRUCOES_QUE_CRIAM_EXECUTOR, EXECUTORES } from '@/config/executores';

const RAIZ = path.join(__dirname, '..', '..');

/**
 * INV-41 — todo executor do sistema está classificado.
 *
 * A quarta aplicação do mesmo procedimento: INV-26 para rotas, INV-29 para
 * tabelas, INV-32 para tabelas alcançadas por cascade, e agora executores.
 *
 * Existe porque a pior falha desta safra foi um `spawn` rodando com o `HOME` do
 * usuário do sistema e o conjunto nativo inteiro de tools — e as invariantes 25 a
 * 38 governavam o que o SERVIDOR aceita, não quem executa.
 *
 * "Pergunte onde está a fronteira" pediria julgamento no instante, e é a categoria
 * que esta safra mostrou que falha. Mas a fronteira só se move quando entra um
 * novo principal de execução, e isso tem assinatura sintática — então o gate
 * procura a assinatura e exige a classificação.
 */
function arquivosDeCodigo(): string[] {
  const encontrados: string[] = [];

  const percorrer = (diretorio: string) => {
    for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
      const caminho = path.join(diretorio, entrada.name);
      if (entrada.isDirectory()) {
        percorrer(caminho);
      } else if (
        (entrada.name.endsWith('.ts') || entrada.name.endsWith('.js')) &&
        !entrada.name.includes('.test.')
      ) {
        encontrados.push(caminho);
      }
    }
  };

  for (const raiz of ['src', 'scripts', 'deploy']) {
    const completo = path.join(RAIZ, raiz);
    if (fs.existsSync(completo)) percorrer(completo);
  }

  return encontrados;
}

/**
 * O arquivo que DECLARA a lista de construções não é um executor.
 *
 * `CONSTRUCOES_QUE_CRIAM_EXECUTOR` é um array de strings — `'spawn('`,
 * `'new PrismaClient'` — e elas casam com o próprio grep. Sem esta exclusão o gate
 * acusava seis ocorrências no arquivo que existe para governá-las.
 *
 * Exceção sem propriedade conferida é whitelist, e whitelist apodrece: o caso
 * `o arquivo da lista não IMPORTA nada que execute` é o que impede alguém
 * acrescentar um `spawn` de verdade ali e ficar invisível.
 */
const ARQUIVO_QUE_DECLARA_A_LISTA = 'src/config/executores.ts';

/** Ocorrência = arquivo + construção. Uma linha da tabela de perímetro. */
function ocorrencias(): { arquivo: string; construcao: string }[] {
  const achadas: { arquivo: string; construcao: string }[] = [];

  for (const caminho of arquivosDeCodigo()) {
    const fonte = fs.readFileSync(caminho, 'utf8');
    // Linha por linha, ignorando comentário: a tabela de perímetro CITA as
    // construções na prosa que explica cada uma, e casar nelas contaria a
    // documentação como executor.
    const linhas = fonte.split('\n').filter((linha) => {
      const limpa = linha.trimStart();
      return !limpa.startsWith('//') && !limpa.startsWith('*') && !limpa.startsWith('/*');
    });

    const relativo = path.relative(RAIZ, caminho).replaceAll('\\', '/');
    if (relativo === ARQUIVO_QUE_DECLARA_A_LISTA) continue;

    for (const construcao of CONSTRUCOES_QUE_CRIAM_EXECUTOR) {
      if (linhas.some((linha) => linha.includes(construcao))) {
        achadas.push({ arquivo: relativo, construcao });
      }
    }
  }

  return achadas;
}

/** O `onde` da tabela cita arquivo e construção; casa por conter os dois. */
function estaClassificada(ocorrencia: { arquivo: string; construcao: string }): boolean {
  const semParenteses = ocorrencia.construcao.replace('(', '');
  return EXECUTORES.some(
    (executor) =>
      executor.onde.includes(ocorrencia.arquivo) && executor.onde.includes(semParenteses)
  );
}

describe('INV-41 — todo executor do sistema está classificado', () => {
  it('INV-41: o enumerador acha as ocorrências — vazio não prova nada', () => {
    // O caso vizinho do próprio gate, quarta vez. Um enumerador que devolvesse
    // lista vazia faria a comparação abaixo passar sem examinar nada.
    const achadas = ocorrencias();

    expect(achadas.length).toBeGreaterThanOrEqual(5);
    expect(achadas.map((o) => `${o.arquivo}:${o.construcao}`)).toEqual(
      expect.arrayContaining([
        'src/assistant/motor-cli.ts:spawn(',
        'src/mcp/query.ts:new PrismaClient',
        'src/config/database.ts:new PrismaClient',
      ])
    );
  });

  it('INV-41: adversário — nenhum executor existe sem estar classificado', () => {
    const naoClassificadas = ocorrencias().filter((o) => !estaClassificada(o));

    // A mensagem carrega arquivo e construção porque quem quebrar isto precisa
    // saber o que classificar — e a classificação exige dizer DE QUEM É O
    // PRIVILÉGIO, que é o campo que força a percepção.
    expect(naoClassificadas.map((o) => `${o.arquivo} → ${o.construcao}`)).toEqual([]);
  });

  it('INV-41: adversário — `spawn` novo e não classificado REPROVA', () => {
    // Constrói o caso que o gate deveria pegar, sem editar arquivo: simula uma
    // ocorrência nova e confere que a comparação a acusa.
    const comIntruso = [
      ...ocorrencias(),
      { arquivo: 'src/algo/novo.ts', construcao: 'spawn(' },
    ];
    const naoClassificadas = comIntruso.filter((o) => !estaClassificada(o));

    expect(naoClassificadas.map((o) => o.arquivo)).toEqual(['src/algo/novo.ts']);
  });

  it('INV-41: nenhuma entrada da tabela aponta para arquivo inexistente', () => {
    // O outro lado: tabela que apodrece. Entrada morta descreve um perímetro que
    // já não existe, e é pior que entrada faltando — ela dá a impressão de
    // cobertura.
    const fantasmas = EXECUTORES.filter((executor) => {
      const arquivo = executor.onde.split(' →')[0]!.trim();
      return !fs.existsSync(path.join(RAIZ, arquivo));
    });

    expect(fantasmas.map((e) => e.onde)).toEqual([]);
  });

  it('INV-41: toda entrada declara a CREDENCIAL, que é o campo que força a percepção', () => {
    // Não é formalidade. Escrever "o HOME de quem instalou o CLI" ao lado de
    // "apenas tools MCP" não sobrevive à leitura sem alguém notar a distância
    // entre as duas colunas — e foi a ausência dessa linha que deixou o subprocesso
    // sem governo.
    for (const executor of EXECUTORES) {
      expect(executor.credencial.length).toBeGreaterThan(20);
      expect(executor.quem.length).toBeGreaterThan(5);
      expect(executor.superficie.length).toBeGreaterThan(10);
      // `governadaPor` diz a invariante OU por que nenhuma governa. As duas
      // respostas são legítimas; o silêncio não é.
      expect(executor.governadaPor.length).toBeGreaterThan(30);
    }
  });

  it('INV-41: a exclusão do arquivo da lista é segura — ele não IMPORTA nada que execute', () => {
    // A propriedade que torna a exceção aceitável, e sem a qual ela seria uma
    // whitelist. Se alguém acrescentar um `spawn` de verdade em `executores.ts`,
    // este caso cai — enquanto o gate principal, que o exclui, não veria.
    const fonte = fs.readFileSync(path.join(RAIZ, ARQUIVO_QUE_DECLARA_A_LISTA), 'utf8');

    expect(fonte).not.toMatch(/from\s+'node:child_process'/);
    expect(fonte).not.toMatch(/from\s+'@prisma\/client'/);
    expect(fonte).not.toMatch(/from\s+'node:vm'/);
    // Nem import dinâmico, que passaria pelas três linhas acima.
    expect(fonte).not.toMatch(/require\(|await import\(/);
  });

  it('INV-41: os dois executores com DELETE FÍSICO dizem isso em voz alta', () => {
    // `purge` e `reter-telemetria` apagam de verdade. Um executor com esse poder
    // que não o declarasse na tabela seria a pior linha possível: parece
    // classificado e esconde o que importa.
    const comDeleteFisico = EXECUTORES.filter((e) => /DELETE FÍSICO/i.test(e.credencial));

    expect(comDeleteFisico.map((e) => e.onde.split(' →')[0]!.trim()).sort()).toEqual([
      'scripts/purge.ts',
      'scripts/reter-telemetria.ts',
    ]);
  });
});
