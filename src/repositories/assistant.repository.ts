import { prisma } from '@/config/database';
import type { AiCall, Conversation, ConversationMessage, PendingAction } from '@prisma/client';

/**
 * A única porta do banco para o assistente conversacional (INV-02).
 *
 * Existe porque o gate de INV-02 pegou o service, o controller e o orçamento
 * importando `prisma` direto — e o gate estava certo. Eu havia acessado o banco
 * de três lugares por conveniência, exatamente a violação que a invariante existe
 * para impedir: ela é do tipo que não quebra nada em execução e destrói a camada.
 *
 * O que este arquivo NÃO faz, e é deliberado: nenhuma regra de decisão. Ele não
 * sabe o que é uma ação aprovável nem quando o teto foi excedido — só lê e grava.
 * A decisão vive no service, onde ela é testável sem banco.
 */
export class AssistantRepository {
  criarConversa(userId: string, title: string): Promise<Conversation> {
    return prisma.conversation.create({ data: { userId, title } });
  }

  acharConversa(id: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({ where: { id } });
  }

  acharConversaDoUsuario(id: string, userId: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({ where: { id, userId } });
  }

  listarConversas(userId: string, limite = 50) {
    return prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limite,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  conversaComHistorico(id: string, userId: string) {
    return prisma.conversation.findFirst({
      where: { id, userId },
      include: {
        messages: { orderBy: { ordem: 'asc' } },
        actions: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /**
   * Grava a mensagem e toca a conversa, em transação.
   *
   * Em transação porque `updatedAt` é o que ordena a lista de conversas: uma
   * mensagem gravada sem o toque deixaria a conversa afundada na lista, e quem
   * conversou não a encontraria.
   */
  async gravarMensagem(
    conversationId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string
  ): Promise<void> {
    await prisma.$transaction([
      prisma.conversationMessage.create({ data: { conversationId, role, content } }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
  }

  mensagensEmOrdem(conversationId: string): Promise<ConversationMessage[]> {
    // Por `ordem`, não por `createdAt`: o timestamp empata no mesmo milissegundo,
    // e conversa fora de ordem é conversa diferente. Mesma razão de
    // `HabitRevision.ordem`.
    return prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { ordem: 'asc' },
    });
  }

  criarAcao(dados: {
    conversationId: string;
    toolUseId: string;
    metodo: string;
    path: string;
    corpo: string | null;
    resumo: string;
    expiresAt: Date;
  }): Promise<PendingAction> {
    return prisma.pendingAction.create({ data: dados });
  }

  /** Ações de uma conversa, da mais antiga para a mais nova. */
  acoesDaConversa(conversationId: string): Promise<PendingAction[]> {
    return prisma.pendingAction.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  acharAcaoComConversa(id: string) {
    return prisma.pendingAction.findFirst({ where: { id }, include: { conversation: true } });
  }

  atualizarAcao(
    id: string,
    dados: {
      status: 'approved' | 'rejected' | 'failed' | 'expired';
      resultStatus?: number;
      resultBody?: string;
    }
  ): Promise<PendingAction> {
    return prisma.pendingAction.update({
      where: { id },
      data: { ...dados, decidedAt: new Date() },
    });
  }

  registrarChamada(dados: {
    userId: string;
    conversationId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    durationMs: number;
    outcome: string;
    engine?: string;
    costUsd?: number;
  }): Promise<AiCall> {
    return prisma.aiCall.create({ data: dados });
  }

  /** Guarda a sessão do CLI na conversa. Ver `Conversation.cliSessionId`. */
  async guardarSessaoDoCli(conversationId: string, cliSessionId: string): Promise<void> {
    await prisma.conversation.update({ where: { id: conversationId }, data: { cliSessionId } });
  }

  /**
   * Consumo desde um instante: tokens de saída E custo em dólares.
   *
   * Os dois numa consulta porque os dois tetos são conferidos juntos, e duas
   * consultas dariam duas leituras de instantes diferentes — a segunda podendo
   * incluir uma chamada que a primeira não viu.
   */
  async consumoDesde(userId: string, desde: Date): Promise<{ saida: number; custo: number }> {
    const soma = await prisma.aiCall.aggregate({
      where: { userId, createdAt: { gte: desde } },
      _sum: { outputTokens: true, costUsd: true },
    });

    return {
      saida: soma._sum.outputTokens ?? 0,
      // `Decimal` do Prisma para número: o total do dia não passa de dezenas de
      // dólares, então a perda de precisão do `Number` é irrelevante AQUI — o
      // motivo de a coluna ser `Decimal` é a soma no banco, não este retorno.
      custo: Number(soma._sum.costUsd ?? 0),
    };
  }
}

export const assistantRepository = new AssistantRepository();
