import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { OrderStatus } from "@prisma/client";
import { corsMiddleware } from "../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { outletId } = req.query;

    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required" });
    }

    const orders = await prisma.order.findMany({
      where: {
        outletId: outletId as string,
        status: OrderStatus.PAID,
      },
      include: {
        diningTable: true,
        waiter: {
          select: {
            id: true,
            username: true,
            role: true,
            outletId: true,
          },
        },
        orderType: true,
        outlet: true,

        items: {
          include: {
            food: {
              include: {
                foodCategory: true,
              },
            },
            options: {
              include: {
                option: true,
              },
            },
          },
        },
      },
      orderBy: {
        orderNumber: "asc",
      },
    });

    res.status(200).json(orders);
  } catch (err) {
    console.error("Failed to fetch orders:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
