import Anthropic from '@anthropic-ai/sdk';
import { aiConfigured, env } from '@/config/env';
import { assistantRepository, AssistantRepository } from '@/repositories/assistant.repository';
import { GatewayDeQuery } from '@/mcp/query';
import { GatewayDeRequest, ROTAS_PERMITIDAS } from '@/mcp/request';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from '@/utils/errors';
import { logger } from '@/utils/logger';
import { toDayKey, utcStartOfDay } from '@/utils/helpers';
import { cliDisponivel, MotorCli } from './motor-cli';
import { orcamentoDoDia } from './orcamento';
import { promptDoSistema, promptDoSistemaParaCli } from './prompt';
import { AGIR, CONSULTAR } from './tools';

/**
 * O laço do agente conversacional.
 *
 * ## A fronteira, em uma frase
 *
 * Leitura executa; escrita **para**. O modelo consulta o quanto precisar e, no
 * instante em que quer alterar algo, o laço termina e devolve uma proposta. Quem
 * a converte em escrita é um `POST .../approve` da pessoa.
 *
 * Isso muda o lugar da garantia em relação ao MCP. Lá o cliente é o Claude Code,
 * que tem mecanismo próprio de confirmação; aqui o cliente é o dashboard, e sem a
 * parada "a decisão é do usuário" dependeria de o prompt ser obedecido.
 *
 * ## O que este arquivo NÃO pode fazer, por construção
 *
 * - **Escrever no banco pela aplicação.** Ele não importa repositório nem service.
 *   Toda escrita sai pela allowlist do `GatewayDeRequest`, e só depois da
 *   aprovação.
 * - **Ler dado de outra pessoa.** O `consultar` vai pelo `GatewayDeQuery`, que usa
 *   a role somente-leitura com RLS.
 * - **Vazar a chave.** Ela existe só aqui e no `narrator.anthropic.ts`; o cliente
 *   fala com este servidor, nunca com a Anthropic.
 *
 * ## Eventos
 *
 * O serviço não escreve HTTP: ele emite eventos e quem chama decide o transporte.
 * É o que deixa o mesmo laço servir o SSE do dashboard e os testes, sem o teste
 * ter de falar streaming.
 */
export type EventoDoAssistente =
  | { tipo: 'texto'; delta: string }
  | { tipo: 'ferramenta'; nome: string; resumo: string }
  | { tipo: 'resultado'; nome: string; linhas?: number; erro?: string }
  | { tipo: 'acao'; acao: AcaoProposta }
  | { tipo: 'fim'; motivo: 'completo' | 'aguardando_aprovacao' | 'teto_de_voltas' }
  | { tipo: 'erro'; mensagem: string };

export interface AcaoProposta {
  id: string;
  metodo: string;
  path: string;
  corpo: unknown;
  resumo: string;
  /** A proposta recém-criada sempre aguarda decisão humana. */
  status: 'pending';
  expiresAt: string;
}

type Emitir = (evento: EventoDoAssistente) => void;

interface BlocoDeFerramenta {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export class AssistantService {
  constructor(
    private readonly gatewayDeQuery: GatewayDeQuery | null,
    private readonly gatewayDeRequest: GatewayDeRequest,
    private readonly cliente: Anthropic | null = aiConfigured()
      ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
      : null,
    private readonly repo: AssistantRepository = assistantRepository,
    private readonly motorCli: MotorCli = new MotorCli()
  ) {}

  /**
   * Qual motor atende, e a ordem é deliberada.
   *
   * A chave da API ganha quando existe: ela é ~10x mais barata e ~3x mais rápida
   * que o CLI (medido: $0.02/3s contra $0.16/10s), e roda no container. O CLI é o
   * caminho para quem não quer uma chave separada — usa a assinatura do Claude
   * Code, ao custo de latência, de consumo e de só funcionar onde o CLI está
   * instalado e autenticado.
   *
   * Ordem e não configuração explícita porque a escolha certa é sempre a mesma:
   * se há chave, use a chave. Uma variável para inverter isso seria uma chance de
   * alguém rodar o caminho caro sem querer.
   */
  private motor(): 'api' | 'cli' | null {
    if (this.cliente) return 'api';
    if (cliDisponivel().ok) return 'cli';
    return null;
  }

  /**
   * Sem chave, o chat NÃO tem alternativa determinística — ao contrário do resumo
   * de aderência, que tem. Conversar é a função; não há template que a substitua.
   *
   * Então a degradação é honesta em vez de inventada: o endpoint recusa com um
   * motivo legível e o resto do app segue idêntico (INV-15). Fingir uma resposta
   * seria pior que recusar.
   */
  disponivel(): { ok: boolean; motivo?: string; motor?: 'api' | 'cli' } {
    const motor = this.motor();

    if (!motor) {
      return {
        ok: false,
        motivo:
          'O assistente precisa de um motor: ou ANTHROPIC_API_KEY (chave da Anthropic), ou ' +
          'CLAUDE_CLI_PATH apontando para o `claude` instalado e autenticado nesta máquina. ' +
          'Todo o resto do app funciona sem os dois.',
      };
    }
    if (!this.gatewayDeQuery) {
      return {
        ok: false,
        motivo:
          'O assistente precisa da conexão somente-leitura do banco. Configure DATABASE_URL_READONLY.',
      };
    }
    return { ok: true, motor };
  }

  /** Cria a conversa ou confere que ela é de quem diz ser. */
  async abrirConversa(
    userId: string,
    conversationId: string | undefined,
    primeiraMensagem: string
  ) {
    if (!conversationId) {
      // O título é a primeira linha da primeira mensagem, cortada. Pedir ao
      // modelo para titular custaria uma chamada por conversa.
      return this.repo.criarConversa(
        userId,
        primeiraMensagem.split('\n')[0]!.slice(0, 80) || 'Nova conversa'
      );
    }

    const conversa = await this.repo.acharConversa(conversationId);
    if (!conversa) throw new NotFoundError('Conversation');
    // INV-03 aplicado à conversa: o dono vem do JWT, e a conversa pedida pelo
    // corpo é conferida contra ele.
    if (conversa.userId !== userId) throw new ForbiddenError('Esta conversa não é sua');

    return conversa;
  }

  /**
   * Uma volta completa: a mensagem da pessoa entra, o laço roda, os eventos saem.
   *
   * `token` é o JWT de quem está conversando, e serve para a execução de uma ação
   * aprovada sair pela API com a identidade certa. O laço em si não o usa —
   * `consultar` vai pelo banco.
   */
  async responder(input: {
    userId: string;
    token: string;
    conversationId: string;
    mensagem: string;
    emitir: Emitir;
  }): Promise<void> {
    const { userId, token, conversationId, mensagem, emitir } = input;

    const disponibilidade = this.disponivel();
    if (!disponibilidade.ok) {
      throw new BadRequestError(disponibilidade.motivo!);
    }

    const orcamento = await orcamentoDoDia(userId);
    if (orcamento.excedido) {
      throw new TooManyRequestsError(
        orcamento.motivo === 'custo'
          ? `Teto diário de custo atingido (US$ ${orcamento.tetoDeCusto}). Volta à meia-noite UTC.`
          : `Teto diário atingido (${orcamento.teto} tokens de saída). Volta à meia-noite UTC.`
      );
    }

    await this.gravar(conversationId, 'user', mensagem);

    if (this.motor() === 'cli') {
      await this.responderPeloCli({ userId, token, conversationId, mensagem, emitir });
      return;
    }

    await this.rodarLaco({ userId, conversationId, emitir });
  }

  /**
   * O caminho do CLI: uma invocação, o laço de ferramentas é dele.
   *
   * A escrita não para no meio como no motor da API — ela **não existe**. O
   * subprocesso alcança `/mcp/assistente`, que só tem `consultar` e `propor`, e
   * `propor` grava uma `PendingAction`. Então o CLI termina normalmente e as
   * propostas que ele criou são lidas do banco depois.
   *
   * É por isso que este caminho não emite `texto` em pedaços: o CLI devolve a
   * resposta inteira ao terminar. Streaming de verdade exigiria
   * `--output-format stream-json`, e está declarado como trabalho seguinte em
   * `docs/ASSISTENTE.md`.
   */
  private async responderPeloCli(input: {
    userId: string;
    token: string;
    conversationId: string;
    mensagem: string;
    emitir: Emitir;
  }): Promise<void> {
    const conversa = await this.repo.acharConversa(input.conversationId);
    const inicio = Date.now();

    // Quais propostas já existiam. A diferença depois é o que ESTA mensagem
    // criou — comparar por instante seria frágil com relógio de milissegundo, e
    // o conjunto de ids é exato.
    const antes = new Set(
      (await this.repo.acoesDaConversa(input.conversationId)).map((acao) => acao.id)
    );

    input.emitir({ tipo: 'ferramenta', nome: 'claude-code', resumo: 'pensando na sua assinatura' });

    let resposta;
    try {
      resposta = await this.motorCli.perguntar({
        token: input.token,
        conversationId: input.conversationId,
        sessionId: conversa?.cliSessionId ?? null,
        mensagem: input.mensagem,
        sistema: promptDoSistemaParaCli(toDayKey(utcStartOfDay())),
      });
    } catch (erro) {
      await this.repo.registrarChamada({
        userId: input.userId,
        conversationId: input.conversationId,
        model: `cli:${env.ASSISTANT_MODEL}`,
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        durationMs: Date.now() - inicio,
        outcome: erro instanceof Error ? `erro:${erro.name}` : 'erro:desconhecido',
        engine: 'cli',
      });
      throw erro;
    }

    await this.repo.registrarChamada({
      userId: input.userId,
      conversationId: input.conversationId,
      model: `cli:${env.ASSISTANT_MODEL}`,
      inputTokens: 0,
      outputTokens: resposta.tokensDeSaida,
      toolCalls: resposta.turnos,
      durationMs: resposta.duracaoMs,
      outcome: resposta.desfecho,
      engine: 'cli',
      costUsd: resposta.custoUsd,
    });

    if (resposta.sessionId.length > 0 && resposta.sessionId !== conversa?.cliSessionId) {
      await this.repo.guardarSessaoDoCli(input.conversationId, resposta.sessionId);
    }

    if (resposta.texto.length > 0) {
      input.emitir({ tipo: 'texto', delta: resposta.texto });
      // O histórico do MODELO vive na sessão do CLI; este registro é para a
      // interface poder reabrir a conversa. Guardar no formato de blocos mantém
      // um só caminho de leitura no `paraInterface`.
      await this.gravar(
        input.conversationId,
        'assistant',
        JSON.stringify([{ type: 'text', text: resposta.texto }])
      );
    }

    const novas = (await this.repo.acoesDaConversa(input.conversationId)).filter(
      (acao) => !antes.has(acao.id)
    );

    for (const acao of novas) {
      input.emitir({
        tipo: 'acao',
        acao: {
          id: acao.id,
          metodo: acao.metodo,
          path: acao.path,
          corpo: acao.corpo === null ? null : (JSON.parse(acao.corpo) as unknown),
          resumo: acao.resumo,
          status: 'pending',
          expiresAt: acao.expiresAt.toISOString(),
        },
      });
    }

    input.emitir({
      tipo: 'fim',
      motivo: novas.length > 0 ? 'aguardando_aprovacao' : 'completo',
    });
  }

  /**
   * Retoma o laço depois de uma ação decidida.
   *
   * Existe para a aprovação não terminar a conversa: o resultado da escrita entra
   * no histórico como resultado de ferramenta, e o modelo continua de onde parou —
   * pode confirmar o que mudou, ou propor o passo seguinte.
   *
   * Sem isto, aprovar seria um beco: a pessoa clicaria, a escrita aconteceria, e
   * ela teria de escrever "e agora?" para o assistente perceber.
   */
  async retomar(input: {
    userId: string;
    token: string;
    conversationId: string;
    emitir: Emitir;
  }): Promise<void> {
    if (this.motor() === 'cli') {
      // No CLI a retomada é uma mensagem como outra: o resultado da ação aprovada
      // já está no banco, e o modelo o descobre consultando. Não há `tool_result`
      // a devolver porque o laço não é nosso.
      //
      // A mensagem é sintética e marcada como tal. Inventar uma fala da pessoa
      // ("obrigado, aplicou?") poluiria o histórico com algo que ela não disse.
      await this.responderPeloCli({
        ...input,
        mensagem:
          '[sistema] A pessoa decidiu sobre a sua última proposta. Confira o resultado ' +
          'consultando os dados e diga em uma frase o que ficou. Se ela recusou, não insista.',
      });
      return;
    }

    await this.rodarLaco(input);
  }

  private async rodarLaco({
    userId,
    conversationId,
    emitir,
  }: {
    userId: string;
    conversationId: string;
    emitir: Emitir;
  }): Promise<void> {
    const sistema = promptDoSistema(toDayKey(utcStartOfDay()));

    for (let volta = 0; volta < env.ASSISTANT_MAX_TURNS; volta += 1) {
      const historico = await this.historico(conversationId);
      const inicio = Date.now();

      let resposta: Anthropic.Message;
      try {
        resposta = await this.cliente!.messages.create({
          // `ASSISTANT_MODEL` e não `ANTHROPIC_MODEL`: a redação do resumo de
          // aderência é um parágrafo por visita e usa Opus; o assistente dá
          // várias voltas por mensagem e usa Sonnet, que mediu 47% mais barato
          // com a mesma resposta.
          model: env.ASSISTANT_MODEL,
          max_tokens: env.AI_MAX_OUTPUT_TOKENS,
          system: sistema,
          messages: historico,
          tools: FERRAMENTAS,
        });
      } catch (erro) {
        await this.registrarChamada({
          userId,
          conversationId,
          entrada: 0,
          saida: 0,
          ferramentas: 0,
          duracao: Date.now() - inicio,
          desfecho: erro instanceof Error ? `erro:${erro.name}` : 'erro:desconhecido',
        });
        // INV-16: o erro da Anthropic pode carregar trecho do prompt. O que sai
        // para o cliente é genérico; o detalhe fica no log do servidor.
        logger.error('falha na chamada ao modelo', erro);
        emitir({ tipo: 'erro', mensagem: 'O assistente não conseguiu responder agora.' });
        return;
      }

      const blocosDeFerramenta = resposta.content.filter(
        (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === 'tool_use'
      );

      await this.registrarChamada({
        userId,
        conversationId,
        entrada: resposta.usage.input_tokens,
        saida: resposta.usage.output_tokens,
        ferramentas: blocosDeFerramenta.length,
        duracao: Date.now() - inicio,
        desfecho: resposta.stop_reason ?? 'sem_motivo',
      });

      for (const bloco of resposta.content) {
        if (bloco.type === 'text' && bloco.text.length > 0) {
          emitir({ tipo: 'texto', delta: bloco.text });
        }
      }

      await this.gravar(conversationId, 'assistant', JSON.stringify(resposta.content));

      if (blocosDeFerramenta.length === 0) {
        emitir({ tipo: 'fim', motivo: 'completo' });
        return;
      }

      const resultados: Anthropic.ToolResultBlockParam[] = [];
      let aguardando = false;

      for (const bloco of blocosDeFerramenta) {
        if (bloco.name === AGIR) {
          // A parada. Nada é executado: a proposta é gravada e o laço termina.
          const acao = await this.propor(conversationId, bloco);
          emitir({ tipo: 'acao', acao });
          aguardando = true;
          // As demais ferramentas desta volta são descartadas de propósito: uma
          // proposta por vez. Executar leituras "junto" de uma proposta pendente
          // deixaria o histórico com resultado de algo que a pessoa ainda não viu.
          break;
        }

        resultados.push(await this.consultar(userId, bloco, emitir));
      }

      if (aguardando) {
        emitir({ tipo: 'fim', motivo: 'aguardando_aprovacao' });
        return;
      }

      await this.gravar(conversationId, 'tool', JSON.stringify(resultados));
    }

    // O teto de voltas foi atingido. Dito em voz alta em vez de a conversa
    // simplesmente parar: silêncio seria indistinguível de resposta completa.
    emitir({ tipo: 'texto', delta: '\n\n(Parei aqui — dei muitas voltas nesta pergunta.)' });
    emitir({ tipo: 'fim', motivo: 'teto_de_voltas' });
  }

  private async consultar(
    userId: string,
    bloco: BlocoDeFerramenta,
    emitir: Emitir
  ): Promise<Anthropic.ToolResultBlockParam> {
    const entrada = bloco.input as { sql?: string; motivo?: string };
    emitir({
      tipo: 'ferramenta',
      nome: CONSULTAR,
      resumo: entrada.motivo ?? 'consultando',
    });

    try {
      const resultado = await this.gatewayDeQuery!.executar(userId, entrada.sql ?? '');
      emitir({ tipo: 'resultado', nome: CONSULTAR, linhas: resultado.linhas.length });

      return {
        type: 'tool_result',
        tool_use_id: bloco.id,
        content: JSON.stringify(resultado),
      };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
      emitir({ tipo: 'resultado', nome: CONSULTAR, erro: mensagem });

      // `is_error` para o modelo saber que falhou e poder corrigir a consulta em
      // vez de tratar a mensagem de erro como dado.
      return {
        type: 'tool_result',
        tool_use_id: bloco.id,
        is_error: true,
        content: mensagem,
      };
    }
  }

  private async propor(conversationId: string, bloco: BlocoDeFerramenta): Promise<AcaoProposta> {
    const entrada = bloco.input as {
      metodo?: string;
      path?: string;
      corpo?: unknown;
      resumo?: string;
    };
    const metodo = (entrada.metodo ?? '').toUpperCase();
    const path = entrada.path ?? '';

    // Conferência na PROPOSTA, além da conferência na aprovação. Duas porque
    // servem a coisas diferentes: aqui é para a pessoa não ver um cartão que
    // nunca poderia ser executado; lá é a garantia. A da aprovação é a que conta.
    if (!rotaPermitida(metodo, path)) {
      throw new ForbiddenError(`${metodo} ${path} não está no alcance do assistente.`);
    }

    const expiresAt = new Date(Date.now() + env.ASSISTANT_ACTION_TTL_MINUTES * 60_000);

    const acao = await this.repo.criarAcao({
      conversationId,
      toolUseId: bloco.id,
      metodo,
      path,
      corpo: entrada.corpo === undefined ? null : JSON.stringify(entrada.corpo),
      resumo: entrada.resumo ?? `${metodo} ${path}`,
      expiresAt,
    });

    return {
      id: acao.id,
      metodo,
      path,
      corpo: entrada.corpo ?? null,
      resumo: acao.resumo,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Executa uma ação aprovada. É o único caminho de escrita desta camada.
   *
   * A allowlist é conferida DE NOVO aqui. Entre a proposta e a aprovação passam
   * minutos, e o que vale é a lista do momento da execução — se alguém remover uma
   * rota do alcance, uma proposta pendente para ela deve deixar de ser executável.
   */
  async decidir(input: {
    userId: string;
    token: string;
    actionId: string;
    aprovar: boolean;
  }): Promise<{ conversationId: string; status: string; resultado?: unknown }> {
    const acao = await this.repo.acharAcaoComConversa(input.actionId);

    if (!acao) throw new NotFoundError('Action');
    if (acao.conversation.userId !== input.userId) {
      throw new ForbiddenError('Esta ação não é sua');
    }
    if (acao.status !== 'pending') {
      throw new BadRequestError(`Esta ação já foi ${acao.status}.`);
    }
    if (acao.expiresAt.getTime() < Date.now()) {
      await this.repo.atualizarAcao(acao.id, { status: 'expired' });
      throw new BadRequestError('Esta sugestão expirou. Peça de novo ao assistente.');
    }

    if (!input.aprovar) {
      await this.repo.atualizarAcao(acao.id, { status: 'rejected' });
      await this.gravarResultadoDeAcao(acao.conversationId, acao.toolUseId, {
        recusado: true,
        mensagem: 'A pessoa recusou esta ação. Não insista; siga a conversa.',
      });
      return { conversationId: acao.conversationId, status: 'rejected' };
    }

    if (!rotaPermitida(acao.metodo, acao.path)) {
      await this.repo.atualizarAcao(acao.id, { status: 'failed' });
      throw new ForbiddenError(
        `${acao.metodo} ${acao.path} já não está no alcance do assistente e não foi executada.`
      );
    }

    const resposta = await this.gatewayDeRequest.chamar({
      token: input.token,
      metodo: acao.metodo,
      path: acao.path,
      corpo: acao.corpo === null ? undefined : (JSON.parse(acao.corpo) as unknown),
    });

    const deuCerto = resposta.status >= 200 && resposta.status < 300;

    await this.repo.atualizarAcao(acao.id, {
      status: deuCerto ? 'approved' : 'failed',
      resultStatus: resposta.status,
      resultBody: JSON.stringify(resposta.corpo).slice(0, 4000),
    });

    await this.gravarResultadoDeAcao(acao.conversationId, acao.toolUseId, {
      status: resposta.status,
      corpo: resposta.corpo,
    });

    return {
      conversationId: acao.conversationId,
      status: deuCerto ? 'approved' : 'failed',
      resultado: resposta.corpo,
    };
  }

  private async gravarResultadoDeAcao(
    conversationId: string,
    toolUseId: string,
    conteudo: unknown
  ): Promise<void> {
    const resultado: Anthropic.ToolResultBlockParam[] = [
      { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(conteudo) },
    ];
    await this.gravar(conversationId, 'tool', JSON.stringify(resultado));
  }

  private async gravar(
    conversationId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string
  ): Promise<void> {
    await this.repo.gravarMensagem(conversationId, role, content);
  }

  /**
   * O histórico no formato que a API espera.
   *
   * `tool` vira mensagem de `user` porque é assim que o protocolo representa
   * resultado de ferramenta — não é conversão de conveniência, é o formato. O
   * papel `tool` existe no banco para a interface poder distinguir o que mostrar.
   */
  private async historico(conversationId: string): Promise<Anthropic.MessageParam[]> {
    const linhas = await this.repo.mensagensEmOrdem(conversationId);

    return linhas.map((linha) => ({
      role: linha.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content:
        linha.role === 'user'
          ? linha.content
          : (JSON.parse(linha.content) as Anthropic.ContentBlockParam[]),
    }));
  }

  private async registrarChamada(dados: {
    userId: string;
    conversationId: string;
    entrada: number;
    saida: number;
    ferramentas: number;
    duracao: number;
    desfecho: string;
  }): Promise<void> {
    await this.repo.registrarChamada({
      userId: dados.userId,
      conversationId: dados.conversationId,
      model: env.ANTHROPIC_MODEL,
      inputTokens: dados.entrada,
      outputTokens: dados.saida,
      toolCalls: dados.ferramentas,
      durationMs: dados.duracao,
      outcome: dados.desfecho,
    });
  }
}

/** Segmento a segmento, como o gateway do MCP. */
function rotaPermitida(metodo: string, path: string): boolean {
  const semQuery = path.split('?')[0] ?? path;
  if (!semQuery.startsWith('/') || semQuery.includes('..')) return false;

  return ROTAS_PERMITIDAS.some((rota) => {
    if (rota.metodo !== metodo) return false;
    const padrao = rota.padrao.split('/');
    const alvo = semQuery.replace(/\/+$/, '').split('/');
    if (padrao.length !== alvo.length) return false;
    return padrao.every((seg, i) =>
      seg.startsWith(':') ? (alvo[i]?.length ?? 0) > 0 : seg === alvo[i]
    );
  });
}

const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: CONSULTAR,
    description:
      'Executa um SELECT nos dados desta pessoa e devolve as linhas. Somente leitura, garantido ' +
      'por permissão do banco. Use livremente para responder qualquer pergunta sobre os dados.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Um único SELECT.' },
        motivo: { type: 'string', description: 'O que você quer descobrir. Aparece na interface.' },
      },
      required: ['sql', 'motivo'],
    },
  },
  {
    name: AGIR,
    description:
      'PROPÕE uma alteração. Ela NÃO acontece quando você chama: a pessoa vê o seu `resumo` e ' +
      'decide. Se aprovar, você recebe o resultado e continua. Uma proposta por vez.',
    input_schema: {
      type: 'object',
      properties: {
        metodo: { type: 'string', enum: ['POST', 'PUT', 'DELETE'] },
        path: { type: 'string', description: 'Começa com /api/v1. Sem host.' },
        corpo: { type: 'object', description: 'JSON do corpo, quando a rota pedir.' },
        resumo: {
          type: 'string',
          description:
            'Uma frase dizendo o que isto muda para a pessoa. É o texto que ela lê para decidir.',
        },
      },
      required: ['metodo', 'path', 'resumo'],
    },
  },
];
