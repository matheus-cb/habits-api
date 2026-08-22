import { Router } from 'express';
import { InsightsController } from '@/controllers/insights.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { validateBody } from '@/middlewares/validation.middleware';
import { confirmProposalSchema } from '@/schemas/insights.schema';

const router = Router();
const controller = new InsightsController();

// Toda a camada de insights é autenticada: o relatório é sobre os hábitos de uma
// pessoa, e o userId vem do JWT, nunca da rota (INV-10).
router.use(authenticate);

/**
 * @swagger
 * /insights/adherence:
 *   get:
 *     summary: Resumo de aderência — cálculo determinístico com redação assistida
 *     description: >
 *       Os números são calculados no servidor e a IA apenas redige o texto.
 *       Sem ANTHROPIC_API_KEY o endpoint responde igual, com
 *       narration.source = "deterministic".
 *     tags: [Insights]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Relatório e resumo
 */
router.get('/adherence', controller.adherence);

/**
 * @swagger
 * /insights/reschedule-proposals:
 *   get:
 *     summary: Propostas de reagendamento — sugestão assinada, nunca aplicada
 *     description: >
 *       Os dias vêm de um motor determinístico; a IA só redige a justificativa.
 *       Cada proposta traz um token assinado com validade de 10 minutos. Lista
 *       vazia é resultado normal quando não há sinal suficiente.
 *     tags: [Insights]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de propostas
 */
router.get('/reschedule-proposals', controller.proposals);

/**
 * @swagger
 * /insights/reschedule-proposals/confirm:
 *   post:
 *     summary: Aplica uma proposta de reagendamento após confirmação do usuário
 *     description: >
 *       Único caminho por onde uma sugestão de IA altera estado. Exige assinatura
 *       válida, prazo não expirado, e revalida dono, hábito e dias antes de
 *       gravar.
 *     tags: [Insights]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Agendamento atualizado
 *       400:
 *         description: Proposta inválida, adulterada ou expirada
 *       403:
 *         description: A proposta não pertence a quem confirmou
 */
router.post(
  '/reschedule-proposals/confirm',
  validateBody(confirmProposalSchema),
  controller.confirm
);

export default router;
