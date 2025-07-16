// lib/authMiddleware.ts
import { NextApiRequest, NextApiResponse, NextApiHandler } from "next";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

interface JwtPayload {
  id: string;
  role: string;
  outletId: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends NextApiRequest {
  user: {
    id: string;
    role: string;
    outletId: string;
  };
}

export function withAuth(handler: NextApiHandler) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });

      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Safely cast to AuthenticatedRequest
      (req as AuthenticatedRequest).user = {
        id: decoded.id,
        role: decoded.role,
        outletId: decoded.outletId,
      };

      return handler(req, res);
    } catch (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
  };
}
