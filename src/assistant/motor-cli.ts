import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { BadRequestError } from '@/utils/errors';
import { CABECALHO_DE_CONVERSA, TOOLS_DO_ASSISTENTE } from '@/mcp/tools-assistente';
import { enderecoLocal } from '@/mcp/endereco';

/**
 * Motor do assistente sobre o CLI do Claude Code, em modo headless.
 *
 * Existe porque o Matheus pediu que o chat rodasse na assinatura dele em vez de
 * numa chave da API. Funciona, e as três medições que moldaram o desenho estão
 * aqui porque cada uma contradiz uma suposição razoável:
 *
 * ## 1. Reaproveitar a sessão NÃO barateia
 *
 * A hipótese era que `--resume` faria o contexto virar `cache_read` e o custo
 * cair. Medido: primeira mensagem $0.2475, retomada $0.3261. Subiu.
 *
 * O custo é **por volta de ferramenta**: cada volta relê os ~32k tokens de
 * contexto do próprio CLI (system prompt, definições de tool, `CLAUDE.md`). Cinco
 * voltas custam cinco leituras.
 *
 * O que a sessão dá, e é o que importa: **o fio da conversa**. Retomando, o CLI já
 * tem o histórico — uma pergunta de acompanhamento é respondida certo sem o
 * servidor reenviar nada.
 *
 * ## 2. O que barateia é reduzir VOLTAS
 *
 * Dar o esquema do banco no prompt em vez de deixá-lo ler `habits://schema`:
 * $0.2475/12.2s → $0.1642/9.6s. Um terço mais barato, porque cortou uma volta.
 *
 * É também por isso que o perfil `assistente` do MCP não registra os recursos de
 * descoberta: lê-los custaria a volta que o prompt evita.
 *
 * ## 3. `--allowedTools` NÃO restringe
 *
 * Com `--allowedTools "mcp__habits__query"`, o modelo chamou `request` e a chamada
 * chegou ao servidor. Só `--disallowedTools` bloqueia — e depender dela faria tool
 * nova nascer chamável.
 *
 * Por isso a defesa real é topológica: este motor aponta para `/mcp/assistente`,
 * que **não tem** tool de escrita. As duas flags vão junto de todo modo, como
 * camadas, mas nenhuma delas é a garantia.
 *
 * ## O preço estrutural, dito sem enfeite
 *
 * ~$0.16 e ~10s por pergunta, contra ~$0.02 e ~3s pelo SDK. E **não roda no
 * container**: o CLI precisa estar instalado e autenticado na máquina do processo.
 * Para uso pessoal de duas ou três contas isso é aceitável; para produção não é o
 * caminho.
 */

export interface RespostaDoCli {
  texto: string;
  sessionId: string;
  turnos: number;
  custoUsd: number;
  tokensDeSaida: number;
  duracaoMs: number;
  desfecho: string;
}

/** Onde o CLI vive, e se ele está utilizável. */
export function cliDisponivel(): { ok: boolean; motivo?: string } {
  const caminho = env.CLAUDE_CLI_PATH?.trim();

  if (!caminho) {
    return {
      ok: false,
      motivo:
        'O motor do Claude Code precisa de CLAUDE_CLI_PATH apontando para o executável `claude`. ' +
        'Rode `command -v claude` para descobrir o caminho.',
    };
  }
  if (!fs.existsSync(caminho)) {
    return { ok: false, motivo: `CLAUDE_CLI_PATH aponta para ${caminho}, que não existe.` };
  }
  try {
    fs.accessSync(caminho, fs.constants.X_OK);
  } catch {
    return { ok: false, motivo: `${caminho} não é executável.` };
  }

  return { ok: true };
}

export class MotorCli {
  /**
   * Uma pergunta, uma resposta. O laço de ferramentas é do CLI, não nosso.
   *
   * É a diferença central em relação ao motor do SDK: lá o laço é nosso e a
   * escrita para no meio dele. Aqui o CLI roda até o fim, e a escrita **não
   * acontece** porque a tool que escreve não existe na superfície que ele
   * alcança — a proposta vira uma linha em `pending_actions` e o CLI segue.
   */
  async perguntar(input: {
    token: string;
    conversationId: string;
    sessionId: string | null;
    mensagem: string;
    sistema: string;
  }): Promise<RespostaDoCli> {
    const disponibilidade = cliDisponivel();
    if (!disponibilidade.ok) throw new BadRequestError(disponibilidade.motivo!);

    const configuracao = this.escreverConfiguracaoMcp(input.token, input.conversationId);

    try {
      const bruto = await this.executar(configuracao, input);
      return this.interpretar(bruto);
    } finally {
      // O arquivo carrega o JWT. Apagar num `finally` e não depois do parse:
      // se o parse estourar, o token não fica no disco à espera de alguém.
      fs.rmSync(path.dirname(configuracao), { recursive: true, force: true });
    }
  }

  /**
   * Grava a configuração MCP num diretório temporário só desta chamada.
   *
   * O arquivo carrega o JWT de quem conversa e o id da conversa, então ele é
   * efêmero e de permissão restrita. Passar por `--mcp-config` com JSON inline
   * seria melhor e o CLI não aceita — a flag pede caminho.
   */
  private escreverConfiguracaoMcp(token: string, conversationId: string): string {
    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'habits-mcp-'));
    const arquivo = path.join(diretorio, 'mcp.json');

    fs.writeFileSync(
      arquivo,
      JSON.stringify({
        mcpServers: {
          habits: {
            type: 'http',
            // A superfície RESTRITA. Ver `PerfilMcp` — é aqui que a garantia mora.
            url: `${enderecoLocal()}/mcp/assistente`,
            headers: {
              Authorization: `Bearer ${token}`,
              [CABECALHO_DE_CONVERSA]: conversationId,
            },
          },
        },
      }),
      // Só o dono lê. O diretório do `mkdtemp` já é 0700; isto fecha o arquivo.
      { mode: 0o600 }
    );

    return arquivo;
  }

  private executar(
    configuracao: string,
    input: { sessionId: string | null; mensagem: string; sistema: string }
  ): Promise<string> {
    const permitidas = TOOLS_DO_ASSISTENTE.map((nome) => `mcp__habits__${nome}`);

    const argumentos = [
      '-p',
      input.mensagem,
      '--output-format',
      'json',
      '--mcp-config',
      configuracao,
      '--append-system-prompt',
      input.sistema,
      '--allowedTools',
      permitidas.join(' '),
      // Camada redundante e declarada como tal: as tools da superfície completa
      // não existem em `/mcp/assistente`, então negá-las não muda nada hoje. Vai
      // junto porque custa zero e cobre o dia em que alguém aponte este motor
      // para a superfície errada.
      '--disallowedTools',
      'mcp__habits__request mcp__habits__agir',
      ...(input.sessionId ? ['--resume', input.sessionId] : []),
    ];

    return new Promise<string>((resolve, reject) => {
      const processo = spawn(env.CLAUDE_CLI_PATH!, argumentos, {
        // `cwd` no temporário: o CLI carrega o `CLAUDE.md` do diretório onde roda,
        // e rodar dentro do repositório colocaria as regras do PROJETO no contexto
        // de cada pergunta do assistente — dezenas de milhares de tokens por volta,
        // sobre um assunto que não é o dele.
        cwd: path.dirname(configuracao),
        // Ambiente MÍNIMO, e cada variável está aqui por um motivo medido.
        //
        // Não herdar o ambiente inteiro é deliberado: o subprocesso não precisa do
        // `DATABASE_URL` nem do `JWT_SECRET`, e passá-los seria entregar
        // credencial que ele não usa a um processo que executa código de terceiro.
        //
        // As quatro que ficam, e como eu descobri quais:
        //
        // - `HOME` — onde vive a configuração do CLI.
        // - `PATH` — o CLI é um script Node e precisa achar o `node`.
        // - `TERM=dumb` — sem isto o CLI pode tentar desenhar interface.
        // - `USER` — **e esta é a que eu tinha esquecido.** Sem ela o CLI responde
        //   `Not logged in · Please run /login`: a credencial vive no keychain do
        //   macOS, e o keychain resolve o usuário por `USER`. Com apenas
        //   `HOME`+`PATH`+`TERM` a autenticação falha, e o sintoma não menciona
        //   ambiente nenhum — parece que a pessoa não fez login.
        //
        // Bisseccionado: `USER` sozinha resolve. `XPC_SERVICE_NAME`, `LOGNAME` e
        // `SHELL` não são necessárias, e ficam fora.
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          USER: process.env.USER,
          TERM: 'dumb',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let saida = '';
      let erro = '';
      const relogio = setTimeout(() => {
        processo.kill('SIGKILL');
        reject(new BadRequestError('O assistente demorou demais e foi interrompido.'));
      }, env.ASSISTANT_CLI_TIMEOUT_MS);

      processo.stdout.on('data', (pedaco: Buffer) => {
        saida += pedaco.toString();
      });
      processo.stderr.on('data', (pedaco: Buffer) => {
        erro += pedaco.toString();
      });

      processo.on('error', (e) => {
        clearTimeout(relogio);
        reject(e);
      });

      processo.on('close', (codigo) => {
        clearTimeout(relogio);
        if (codigo !== 0) {
          // O stderr do CLI pode carregar trecho de prompt (INV-16), então ele vai
          // para o log do servidor e não para a resposta.
          logger.error('CLI do Claude Code falhou', { codigo, erro: erro.slice(0, 2000) });
          reject(new BadRequestError('O assistente não conseguiu responder agora.'));
          return;
        }
        resolve(saida);
      });
    });
  }

  /**
   * Extrai o JSON da saída.
   *
   * `indexOf('{')` e não `JSON.parse` direto: o CLI às vezes escreve um aviso em
   * texto puro antes do JSON — `Warning: no stdin data received in 3s`. Um parse
   * direto estoura, e o erro aponta para "resposta inválida" quando a resposta
   * está lá, atrás de uma linha de aviso.
   */
  private interpretar(bruto: string): RespostaDoCli {
    const inicio = bruto.indexOf('{');
    if (inicio === -1) {
      logger.error('saída do CLI sem JSON', { bruto: bruto.slice(0, 500) });
      throw new BadRequestError('O assistente devolveu uma resposta que não deu para ler.');
    }

    const dados = JSON.parse(bruto.slice(inicio)) as {
      result?: string;
      is_error?: boolean;
      session_id?: string;
      num_turns?: number;
      total_cost_usd?: number;
      duration_api_ms?: number;
      stop_reason?: string;
      usage?: { output_tokens?: number };
    };

    if (dados.is_error) {
      throw new BadRequestError(dados.result ?? 'O assistente não conseguiu responder.');
    }

    return {
      texto: dados.result ?? '',
      sessionId: dados.session_id ?? '',
      turnos: dados.num_turns ?? 0,
      custoUsd: dados.total_cost_usd ?? 0,
      tokensDeSaida: dados.usage?.output_tokens ?? 0,
      duracaoMs: dados.duration_api_ms ?? 0,
      desfecho: dados.stop_reason ?? 'sem_motivo',
    };
  }
}
