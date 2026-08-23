// `declare global` só é válido dentro de um módulo; o `export {}` é o que torna
// este arquivo um módulo. Antes ele importava `User` do Prisma sem usar — o
// import servia de marcador de módulo e o lint o acusava de morto.
export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
    }
  }
}
