import type { Response, Request, NextFunction } from "express";

export const message = "aposta no cavalo branco viado";

export const message2 = (req: Request, res: Response, next: NextFunction) => {
  console.log(message, "oieoieoei");
  next();
};
