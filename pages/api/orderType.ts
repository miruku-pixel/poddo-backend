import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const orderTypes = await prisma.orderType.findMany({
      orderBy: { name: "asc" },
    });

    res.status(200).json(orderTypes);
  } catch (error) {
    console.error("Error fetching order types:", error);
    res.status(500).json({ error: "Failed to fetch order types" });
  }
};

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
