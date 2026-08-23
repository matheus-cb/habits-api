import { Request, Response } from 'express';
import { InsightsService } from '@/insights/insights.service';
import { createInsightsService } from '@/insights';
import { successResponse } from '@/utils/response';
import { ConfirmProposalInput } from '@/schemas/insights.schema';
import { origemDaRequisicao } from '@/mcp/origem';

export class InsightsController {
  private insights: InsightsService;

  constructor(insights: InsightsService = createInsightsService()) {
    this.insights = insights;
  }

  adherence = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await this.insights.getAdherence(userId);
    return res.status(200).json(successResponse(result));
  };

  proposals = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await this.insights.getProposals(userId);
    return res.status(200).json(successResponse(result));
  };

  confirm = async (req: Request<object, object, ConfirmProposalInput>, res: Response) => {
    const userId = req.user!.id;
    const result = await this.insights.confirmProposal(
      userId,
      req.body.token,
      origemDaRequisicao(req)
    );
    return res.status(200).json(successResponse(result, 'Agendamento atualizado'));
  };
}
