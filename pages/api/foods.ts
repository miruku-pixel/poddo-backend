import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { outletId, orderTypeId } = req.query;

    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required" });
    }

    const foods = await prisma.food.findMany({
      where: {
        available: true,
        outletId: outletId as string,
      },
      orderBy: { createdAt: "asc" },
      include: {
        foodCategory: true,
        options: {
          where: { available: true },
        },
        prices: {
          include: { orderType: true },
        },
      },
    });

    // If orderTypeId is specified, filter prices for each food
    const filteredFoods = orderTypeId
      ? foods.map((food) => ({
          ...food,
          prices: food.prices.filter(
            (price) => price.orderTypeId === orderTypeId
          ),
        }))
      : foods;

    res.status(200).json(filteredFoods);
  } catch (error) {
    console.error("Error fetching food items:", error);
    res.status(500).json({ error: "Failed to fetch food items" });
  }
};

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
