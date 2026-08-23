import { Router } from 'express';
import { z } from 'zod/v4';
import { AssistantController } from '@/assistant/assistant.controller';
import { AssistantService } from '@/assistant/assistant.service';
import { authenticate } from '@/middlewares/auth.middleware';
import { limitarTaxa } from '@/middlewares/rate-limit.middleware';
import { validateBody, validateParams } from '@/middlewares/validation.middleware';
import { criarGatewayDeQuery } from '@/mcp/query';
import { HttpRequestGateway } from '@/mcp/request';

const router = Router();

router.use(authenticate);

/**
 * Teto por usuário, apertado, e **depois** do `authenticate`.
 *
 * 20 por minuto é folgado para conversa e apertado para laço: cada mensagem
 * dispara várias chamadas ao modelo, e o teto de tokens do dia cobre custo — este
 * cobre rajada. Os dois existem porque nenhum cobre o outro: 20 mensagens curtas
 * cabem no minuto e não estouram o dia; uma mensagem que dê dez voltas estoura o
 * dia sem chegar perto do minuto.
 */
router.use(limitarTaxa({ janelaMs: 60_000, maximo: 20, nome: 'o assistente' }));

const service = new AssistantService(criarGatewayDeQuery(), new HttpRequestGateway());
const controller = new AssistantController(service);

const mensagemSchema = z.object({
  mensagem: z.string().min(1, 'Diga algo').max(4000),
  conversationId: z.string().uuid().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @openapi
 * /assistant/status:
 *   get:
 *     summary: O assistente está disponível, e quanto do teto de hoje sobrou
 *     tags: [Assistant]
 */
router.get('/status', controller.status);

/**
 * @openapi
 * /assistant/conversations:
 *   get:
 *     summary: Conversas da pessoa, da mais recente para a mais antiga
 *     tags: [Assistant]
 */
router.get('/conversations', controller.listarConversas);
router.get('/conversations/:id', validateParams(idSchema), controller.historico);

/**
 * @openapi
 * /assistant/messages:
 *   post:
 *     summary: Manda uma mensagem e recebe a resposta em stream (SSE)
 *     description: >
 *       Devolve `text/event-stream`. Cada evento é um JSON com `tipo`:
 *       `inicio`, `texto`, `ferramenta`, `resultado`, `acao`, `fim`, `erro`.
 *       Quando o assistente quer ALTERAR algo, o evento é `acao` e o stream
 *       termina com `fim: aguardando_aprovacao` — nada foi escrito.
 *     tags: [Assistant]
 */
router.post('/messages', validateBody(mensagemSchema), controller.enviar);

/**
 * @openapi
 * /assistant/actions/{id}/approve:
 *   post:
 *     summary: Aprova uma ação proposta e a executa
 *     description: >
 *       Este é o único caminho pelo qual algo que o assistente propôs se torna
 *       escrita. A allowlist é conferida de novo aqui.
 *     tags: [Assistant]
 */
router.post('/actions/:id/approve', validateParams(idSchema), controller.decidir);
router.post('/actions/:id/reject', validateParams(idSchema), controller.decidir);

/** Retoma a conversa depois de uma decisão, em stream. */
router.post('/conversations/:id/resume', validateParams(idSchema), controller.retomar);

export default router;
