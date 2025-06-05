import type { NextApiRequest, NextApiResponse } from "next";
import { withAuth } from "../../../../../middleware/authMiddleware";
import prisma from "../../../../../lib/prisma";
import { OrderItemStatus } from "@prisma/client";
import { corsMiddleware } from "../../../../../middleware/cors";

type UpdateOptionInput = {
  id: string; // This is OrderItemOption.id
  quantity: number;
  status?: "ACTIVE" | "CANCELED";
};

type UpdateOrderItemInput = {
  id: string; // This is OrderItem.id
  quantity: number;
  status?: "ACTIVE" | "CANCELED";
  options?: UpdateOptionInput[];
};

type BatchUpdateRequest = {
  items: UpdateOrderItemInput[];
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { orderId } = req.query;
  const { items }: BatchUpdateRequest = req.body;

  if (!orderId || typeof orderId !== "string") {
    return res.status(400).json({ error: "Order ID is required in the URL." });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ error: "At least one item must be updated." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderTypeId: true },
      });

      if (!existingOrder) {
        throw new Error("Order not found.");
      }

      let totalPriceDifference = 0;

      for (const item of items) {
        const { id: itemId, quantity, status, options } = item;

        const existingItem = await tx.orderItem.findUnique({
          where: { id: itemId },
          include: {
            food: true,
            options: true,
          },
        });

        if (!existingItem) {
          throw new Error(`Order item not found: ${itemId}`);
        }

        const foodPrice = await tx.foodPrice.findUnique({
          where: {
            foodId_orderTypeId: {
              foodId: existingItem.foodId,
              orderTypeId: existingOrder.orderTypeId,
            },
          },
        });

        if (!foodPrice) {
          throw new Error(`No price found for foodId ${existingItem.foodId}`);
        }

        let itemQty = quantity;
        let itemStatus: OrderItemStatus =
          status === "CANCELED"
            ? OrderItemStatus.CANCELED
            : OrderItemStatus.ACTIVE;
        if (itemStatus === "CANCELED") itemQty = 0;

        const itemUnitPrice = foodPrice.price;
        const itemBaseTotal = itemQty * itemUnitPrice;

        let optionTotal = 0;

        if (options?.length) {
          for (const opt of options) {
            const {
              id: optionItemId,
              quantity: optQtyRaw,
              status: optStatusRaw,
            } = opt;

            const existingOption = await tx.orderItemOption.findUnique({
              where: { id: optionItemId },
              include: { option: true }, // To get extraPrice
            });

            if (!existingOption) {
              throw new Error(`Option not found: ${optionItemId}`);
            }

            const optQty = optStatusRaw === "CANCELED" ? 0 : optQtyRaw;
            const optStatus =
              optStatusRaw === "CANCELED"
                ? OrderItemStatus.CANCELED
                : OrderItemStatus.ACTIVE;
            const optUnitPrice = existingOption.option.extraPrice;
            const optTotal = optQty * optUnitPrice;

            optionTotal += optTotal;

            await tx.orderItemOption.update({
              where: { id: optionItemId },
              data: {
                quantity: optQty,
                unitPrice: optUnitPrice,
                totalPrice: optTotal,
                status: optStatus,
              },
            });
          }
        }

        const newTotal = itemBaseTotal + optionTotal;
        const priceDiff = newTotal - existingItem.totalPrice;
        totalPriceDifference += priceDiff;

        await tx.orderItem.update({
          where: { id: itemId },
          data: {
            quantity: itemQty,
            unitPrice: itemUnitPrice,
            totalPrice: newTotal,
            status: itemStatus,
          },
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id: existingOrder.id },
        data: {
          subtotal: { increment: totalPriceDifference },
          total: { increment: totalPriceDifference },
        },
        include: {
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

      return updatedOrder;
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[Batch Update Error]", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update items.",
    });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
