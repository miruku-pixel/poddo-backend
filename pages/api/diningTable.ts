import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { outletId } = req.query;

    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required" });
    }

    const tables = await prisma.diningTable.findMany({
      where: { outletId: outletId as string },
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json(tables);
  } catch (error) {
    console.error("Error fetching table list:", error);
    res.status(500).json({ error: "Failed to fetch table list" });
  }
};

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
