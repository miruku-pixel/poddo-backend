import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Order ID is required" });
  }

  try {
    console.log("Fetching order with id:", id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        diningTable: true,
        waiter: true,
        outlet: true,
        orderType: true,
        items: {
          include: {
            food: true,
            options: {
              include: {
                option: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // --- NEW LOGIC: Fetch OrderTypeDiscount percentage ---
    let orderTypeDiscountPercentage: number | null = null;

    // Only attempt to find a discount if orderType and outlet are available on the order
    if (order.orderTypeId && order.outletId) {
      const discountRecord = await prisma.orderTypeDiscount.findUnique({
        where: {
          orderTypeId_outletId: {
            // Use the compound unique key for lookup
            orderTypeId: order.orderTypeId,
            outletId: order.outletId,
          },
        },
        select: {
          percentage: true,
          isActive: true, // Also check if the discount is active
        },
      });

      // If a discount record is found and it's active, set the percentage
      if (discountRecord?.isActive) {
        orderTypeDiscountPercentage = discountRecord.percentage;
      }
    }
    // --- END NEW LOGIC ---

    // Construct the response object, adding the discount percentage
    const responseOrder = {
      ...order, // Spread all existing order properties
      orderTypeDiscountPercentage: orderTypeDiscountPercentage, // Add the fetched percentage
    };

    res.status(200).json(responseOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
