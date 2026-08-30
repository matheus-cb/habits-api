import { Request, Response, NextFunction } from 'express';
import { registroAberto } from '@/config/env';
import { ForbiddenError } from '@/utils/errors';

/**
 * Guarda de INV-42: recusa criar conta quando o registro está fechado.
 *
 * ## Por que a rota continua registrada
 *
 * O caminho óbvio seria não registrar `POST /auth/register` quando a flag está
 * fechada. Ele quebra o INV-26: `/api/v1/auth/register` está classificada em
 * `ROTAS_NEGADAS` ("criar conta não é assunto de assistente"), e o caso
 * adversário `nenhuma entrada das listas aponta para rota inexistente` reprovaria
 * — a entrada viraria fantasma. Pior: a classificação passaria a depender do
 * ambiente em que o gate roda, que é exatamente o tipo de verificação que só
 * vale onde já é verdadeira.
 *
 * Então a rota existe sempre e o que muda é a resposta.
 *
 * ## Por que ANTES do validateBody
 *
 * Registro fechado é decisão de superfície, não de conteúdo. Validar primeiro
 * responderia 400 com a lista de campos malformados a quem não pode criar conta
 * de todo modo — informação sobre o schema entregue a quem foi recusado. E
 * ordenar assim torna a recusa independente do corpo: qualquer payload, 403.
 *
 * ## Por que a razão vai na resposta
 *
 * 403 sozinho é indistinguível de bug de permissão, e quem administra a
 * instância precisa saber que a causa é configuração e não credencial. O texto
 * nomeia a variável; não expõe o valor de nada.
 */
export function exigirRegistroAberto(_req: Request, _res: Response, next: NextFunction): void {
  if (registroAberto()) {
    next();
    return;
  }

  next(
    new ForbiddenError(
      'A criação de conta está desabilitada nesta instância. ' +
        'Contas são criadas pelo administrador (REGISTRO=fechado).'
    )
  );
}
