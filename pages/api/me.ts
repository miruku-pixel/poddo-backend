import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { user } = req as AuthenticatedRequest;

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { outlet: true },
    });

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      outletId: dbUser.outletId,
      entity: dbUser.outlet?.name || null,
    });
  } catch (err) {
    console.error("[Me API Error]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
