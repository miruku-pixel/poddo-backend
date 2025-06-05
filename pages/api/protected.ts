// pages/api/protected.ts
import type { NextApiResponse, NextApiRequest } from "next";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const user = (req as AuthenticatedRequest).user;
  return res.status(200).json({ message: "OK", user });
};

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
