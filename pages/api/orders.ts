import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { OrderStatus } from "@prisma/client";
import { corsMiddleware } from "../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      diningTableId,
      waiterId,
      outletId,
      orderTypeId,
      customerName,
      onlineCode,
      remark,
      items, // Expecting array of { foodId, quantity, options: [{ optionId, quantity }] }
    } = req.body;

    if (!waiterId) {
      return res.status(400).json({ error: "Missing waiterId" });
    }

    if (!outletId) {
      return res.status(400).json({ error: "Missing outletId" });
    }

    if (!orderTypeId) {
      return res.status(400).json({ error: "Missing orderTypeId" });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "Items must be an array" });
    }

    const dineInOrderType = await prisma.orderType.findUnique({
      where: { id: orderTypeId },
    });

    if (!dineInOrderType) {
      return res.status(400).json({ error: "Invalid orderTypeId" });
    }

    if (dineInOrderType.name === "Dine In" && !diningTableId) {
      return res
        .status(400)
        .json({ error: "Dine In orders require diningTableId" });
    }

    // Step 1: Enrich items with pricing from DB
    const enrichedItems: {
      foodId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      options: {
        create: {
          optionId: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
        }[];
      };
    }[] = [];

    for (const item of items) {
      const foodPrice = await prisma.foodPrice.findUnique({
        where: {
          foodId_orderTypeId: {
            foodId: item.foodId,
            orderTypeId,
          },
        },
        select: { price: true },
      });

      if (!foodPrice)
        return res.status(400).json({
          error: `No price found for foodId: ${item.foodId} and orderTypeId: ${orderTypeId}`,
        });

      const itemUnitPrice = foodPrice.price;
      let itemOptionsTotal = 0;

      const enrichedOptions = [];

      for (const opt of item.options || []) {
        const option = await prisma.foodOption.findUnique({
          where: { id: opt.optionId },
          select: { extraPrice: true },
        });

        if (!option)
          return res
            .status(400)
            .json({ error: `Invalid optionId: ${opt.optionId}` });

        const optTotal = option.extraPrice * opt.quantity;
        itemOptionsTotal += optTotal;

        enrichedOptions.push({
          optionId: opt.optionId,
          quantity: opt.quantity,
          unitPrice: option.extraPrice,
          totalPrice: optTotal,
        });
      }

      const itemTotal = itemUnitPrice * item.quantity + itemOptionsTotal;

      enrichedItems.push({
        foodId: item.foodId,
        quantity: item.quantity,
        unitPrice: itemUnitPrice,
        totalPrice: itemTotal,
        options: {
          create: enrichedOptions,
        },
      });
    }

    // Step 2: Calculate order subtotal and total
    const subtotal = enrichedItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );
    const total = subtotal; // In future, add tax/discount here

    // Step 3: Create order with all values
    const order = await prisma.$transaction(async (tx) => {
      // Lock the counter row for update
      const counter = await tx.orderNumberCounter.upsert({
        where: { outletId },
        update: { current: { increment: 1 } },
        create: { outletId, current: 1 },
      });

      // Generate order number string (e.g., "ORD-00123" or just "123")
      const orderNumber = counter.current.toString().padStart(5, "0");

      const createdAtUTC = new Date(new Date().toISOString());

      // Create the order
      return tx.order.create({
        data: {
          orderNumber,
          diningTableId,
          customerName,
          onlineCode,
          waiterId,
          outletId,
          orderTypeId,
          remark,
          status: OrderStatus.PENDING,
          subtotal,
          total,
          createdAt: createdAtUTC,
          items: {
            create: enrichedItems,
          },
        },
        include: {
          items: {
            include: {
              options: true,
            },
          },
        },
      });
    });

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
