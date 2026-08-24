import { Request, Response } from 'express';
import { assistantRepository, AssistantRepository } from '@/repositories/assistant.repository';
import { successResponse } from '@/utils/response';
import { orcamentoDoDia } from './orcamento';
import { AssistantService, EventoDoAssistente } from './assistant.service';

/**
 * O contorno HTTP do assistente.
 *
 * ## Por que SSE e não WebSocket
 *
 * O fluxo é unidirecional: a pessoa manda uma mensagem por requisição e recebe
 * uma sequência de eventos. WebSocket resolveria isso e traria estado de conexão,
 * reconexão e um segundo caminho de autenticação — para nada, porque não há
 * mensagem do servidor sem requisição da pessoa.
 *
 * ## Por que o token vai na query em `/stream`
 *
 * O `EventSource` do navegador **não aceita cabeçalhos**, e o token precisa chegar.
 * A alternativa seria cookie, e cookie neste app significaria CSRF a resolver —
 * um problema novo para não usar query.
 *
 * O que isso custa e como é contido: token em URL entra em log de servidor e em
 * histórico. Por isso o dashboard **não** usa `EventSource` — usa `fetch` com
 * `Authorization`, que aceita cabeçalho e lê o corpo em stream. A rota de query
 * existe para cliente que não possa fazer isso, e está documentada como o caminho
 * pior.
 */
export class AssistantController {
  constructor(
    private readonly service: AssistantService,
    private readonly repo: AssistantRepository = assistantRepository
  ) {}

  /** Estado do assistente: se está disponível, e quanto do teto de hoje sobrou. */
  status = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const disponibilidade = this.service.disponivel();
    const orcamento = await orcamentoDoDia(userId);

    return res.status(200).json(
      successResponse({
        disponivel: disponibilidade.ok,
        motivo: disponibilidade.motivo ?? null,
        orcamento,
      })
    );
  };

  listarConversas = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const conversas = await this.repo.listarConversas(userId);

    return res.status(200).json(successResponse(conversas));
  };

  /**
   * As mensagens de uma conversa, no formato da INTERFACE — não no do modelo.
   *
   * O banco guarda blocos da API da Anthropic para poder reenviá-los sem
   * tradução. A interface precisa de outra coisa: texto para mostrar, ferramentas
   * para indicar atividade, ações para renderizar cartão. A tradução acontece
   * aqui, num lugar só.
   */
  historico = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const conversa = await this.repo.conversaComHistorico(req.params.id, userId);

    if (!conversa) {
      return res.status(404).json({ status: 'error', message: 'Conversation not found' });
    }

    return res.status(200).json(
      successResponse({
        id: conversa.id,
        title: conversa.title,
        mensagens: conversa.messages.map(paraInterface),
        acoes: conversa.actions.map((acao) => ({
          id: acao.id,
          metodo: acao.metodo,
          path: acao.path,
          corpo: acao.corpo === null ? null : (JSON.parse(acao.corpo) as unknown),
          resumo: acao.resumo,
          status: acao.status,
          expiresAt: acao.expiresAt.toISOString(),
        })),
      })
    );
  };

  enviar = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const token = tokenDaRequisicao(req);
    const { mensagem, conversationId } = req.body as {
      mensagem: string;
      conversationId?: string;
    };

    const conversa = await this.service.abrirConversa(userId, conversationId, mensagem);
    const enviarEvento = abrirStream(res, { conversationId: conversa.id });

    try {
      await this.service.responder({
        userId,
        token,
        conversationId: conversa.id,
        mensagem,
        emitir: enviarEvento,
      });
    } catch (erro) {
      // O stream já começou, então não há como devolver status HTTP. O erro sai
      // como evento — e sair como evento é o que permite a interface mostrá-lo no
      // lugar da resposta em vez de a requisição morrer sem explicação.
      enviarEvento({
        tipo: 'erro',
        mensagem: erro instanceof Error ? erro.message : 'Falha no assistente.',
      });
    } finally {
      res.end();
    }
  };

  decidir = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const token = tokenDaRequisicao(req);
    const aprovar = req.path.endsWith('/approve');

    const decisao = await this.service.decidir({
      userId,
      token,
      actionId: req.params.id,
      aprovar,
    });

    return res.status(200).json(successResponse(decisao));
  };

  /**
   * Retoma a conversa depois de uma decisão, em stream.
   *
   * Separado do `decidir` de propósito: a decisão é uma requisição curta com
   * status HTTP — a interface precisa saber se a escrita deu certo. A retomada é
   * longa e streamada. Juntar as duas faria o cliente esperar o assistente
   * terminar para descobrir se a ação funcionou.
   */
  retomar = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const conversa = await this.repo.acharConversaDoUsuario(req.params.id, userId);

    if (!conversa) {
      return res.status(404).json({ status: 'error', message: 'Conversation not found' });
    }

    const enviarEvento = abrirStream(res, { conversationId: conversa.id });

    try {
      await this.service.retomar({
        userId,
        token: tokenDaRequisicao(req),
        conversationId: conversa.id,
        emitir: enviarEvento,
      });
    } catch (erro) {
      enviarEvento({
        tipo: 'erro',
        mensagem: erro instanceof Error ? erro.message : 'Falha no assistente.',
      });
    } finally {
      res.end();
    }

    // `return` explícito porque o caminho de 404 acima devolve a resposta e o
    // `tsc` exige que todos os caminhos concordem. Depois do stream não há o que
    // devolver — o corpo já foi escrito.
    return undefined;
  };
}

/** Um evento por linha, prefixado — o formato do SSE. */
function abrirStream(res: Response, cabecalho: Record<string, unknown>) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Sem isto, um proxy que agrupa resposta engoliria o streaming e a interface
  // receberia tudo de uma vez no fim — funcionando e sem o efeito que motiva SSE.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const enviar = (evento: unknown) => {
    res.write(`data: ${JSON.stringify(evento)}\n\n`);
  };

  enviar({ tipo: 'inicio', ...cabecalho });
  return enviar as (evento: EventoDoAssistente) => void;
}

function tokenDaRequisicao(req: Request): string {
  return (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
}

function paraInterface(mensagem: { id: string; role: string; content: string; createdAt: Date }) {
  if (mensagem.role === 'user') {
    return { id: mensagem.id, papel: 'user' as const, texto: mensagem.content };
  }

  // `assistant` e `tool` guardam blocos da API. Um `content` que não seja JSON
  // válido é histórico corrompido: devolver o texto cru é melhor que estourar e
  // deixar a conversa inteira ilegível.
  let blocos: { type: string; text?: string; name?: string; input?: unknown }[];
  try {
    blocos = JSON.parse(mensagem.content) as typeof blocos;
  } catch {
    return { id: mensagem.id, papel: 'assistant' as const, texto: mensagem.content };
  }

  if (mensagem.role === 'tool') {
    return { id: mensagem.id, papel: 'ferramenta' as const, texto: '' };
  }

  return {
    id: mensagem.id,
    papel: 'assistant' as const,
    texto: blocos
      .filter((bloco) => bloco.type === 'text')
      .map((bloco) => bloco.text ?? '')
      .join('\n')
      .trim(),
    ferramentas: blocos
      .filter((bloco) => bloco.type === 'tool_use')
      .map((bloco) => ({
        nome: bloco.name ?? '',
        motivo:
          (bloco.input as { motivo?: string; resumo?: string })?.motivo ??
          (bloco.input as { resumo?: string })?.resumo ??
          '',
      })),
  };
}
