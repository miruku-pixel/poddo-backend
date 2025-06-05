import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma"; // Adjust this path if needed
import { corsMiddleware, applyMiddleware } from "../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const outlets = await prisma.outlet.findMany({
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json(outlets);
  } catch (error) {
    console.error("Error fetching outlets:", error);
    res.status(500).json({ error: "Failed to fetch outlets" });
  }
}

export default applyMiddleware(handler, [corsMiddleware]);
