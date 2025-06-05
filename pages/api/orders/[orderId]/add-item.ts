import type { NextApiRequest, NextApiResponse } from "next";
import { withAuth } from "../../../../middleware/authMiddleware"; // Adjust path as needed
import prisma from "../../../../lib/prisma"; // Adjust path as needed
import { Prisma, OrderItemStatus } from "@prisma/client"; // Import Prisma and relevant enums/types
import { corsMiddleware } from "../../../../middleware/cors";

// Define the types for the input when adding a new item
// These types reflect the MINIMAL data needed from the client.
type NewOptionInput = {
  optionId: string;
  quantity: number;
};

type NewOrderItemInput = {
  foodId: string;
  quantity: number;
  options?: NewOptionInput[]; // Options are optional for a food item
};

type AddItemsToOrderRequest = {
  items: NewOrderItemInput[]; // Expecting an array of new items to add
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { orderId } = req.query;
  const { items }: AddItemsToOrderRequest = req.body;

  // Validate orderId
  if (!orderId || typeof orderId !== "string") {
    return res.status(400).json({ error: "Order ID is required in the URL." });
  }

  // Validate request body
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one item is required." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch the existing order to get its current total and orderType
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, subtotal: true, total: true, orderTypeId: true },
      });

      if (!existingOrder) {
        return res.status(404).json({ error: "Order not found." });
      }

      let totalAddedPrice = 0;
      // This array will now hold the data for individual OrderItem creation,
      // which allows for nested `create` for options.
      const orderItemCreateInputs: Prisma.OrderItemCreateInput[] = [];

      // Loop through each new item provided in the request
      for (const item of items) {
        // Validate required fields for a new order item
        if (
          !item.foodId ||
          typeof item.quantity !== "number" ||
          item.quantity <= 0
        ) {
          throw new Error(
            `Invalid food item data. foodId and a positive quantity are required. Item: ${JSON.stringify(
              item
            )}`
          );
        }

        // Get the food price for the current order type
        const foodPrice = await tx.foodPrice.findUnique({
          where: {
            foodId_orderTypeId: {
              foodId: item.foodId,
              orderTypeId: existingOrder.orderTypeId,
            },
          },
          select: { price: true },
        });

        if (!foodPrice) {
          throw new Error(
            `No price found for foodId: ${item.foodId} and orderTypeId: ${existingOrder.orderTypeId}`
          );
        }

        const itemUnitPrice = foodPrice.price;
        let itemOptionsTotal = 0;
        // This array will hold the options data for the current OrderItem
        const newOptionsData: Prisma.OrderItemOptionCreateWithoutOrderItemInput[] =
          [];

        // Loop through each option for the current new item
        for (const opt of item.options || []) {
          if (
            !opt.optionId ||
            typeof opt.quantity !== "number" ||
            opt.quantity <= 0
          ) {
            throw new Error(
              `Invalid option data for optionId: ${opt.optionId}. A positive quantity is required.`
            );
          }

          const foodOption = await tx.foodOption.findUnique({
            where: { id: opt.optionId },
            select: { extraPrice: true },
          });

          if (!foodOption) {
            throw new Error(`Invalid optionId: ${opt.optionId}`);
          }

          const optionTotalPrice = foodOption.extraPrice * opt.quantity;
          itemOptionsTotal += optionTotalPrice;

          newOptionsData.push({
            // Use 'option' relation field with 'connect' for existing FoodOption
            option: {
              connect: {
                id: opt.optionId,
              },
            },
            quantity: opt.quantity,
            unitPrice: foodOption.extraPrice,
            totalPrice: optionTotalPrice,
            status: OrderItemStatus.ACTIVE, // Default status for new options
            createdAt: new Date(), // Set createdAt for new options
          });
        }

        const orderItemTotalPrice =
          itemUnitPrice * item.quantity + itemOptionsTotal;
        totalAddedPrice += orderItemTotalPrice;

        // Collect data for OrderItem creation, including nested options
        orderItemCreateInputs.push({
          // Use 'order' relation field with 'connect' for existing Order
          order: {
            connect: {
              id: existingOrder.id,
            },
          },
          // FIX: Use 'food' relation field with 'connect' for existing Food
          food: {
            connect: {
              id: item.foodId,
            },
          },
          quantity: item.quantity,
          unitPrice: itemUnitPrice,
          totalPrice: orderItemTotalPrice,
          status: OrderItemStatus.ACTIVE, // Default status for new order items
          createdAt: new Date(), // Set createdAt for new order items
          options: {
            create: newOptionsData, // This is where the nested create happens
          },
        });
      }

      // Iterate and use `tx.orderItem.create` for each item.
      const createdOrderItems = [];
      for (const orderItemInput of orderItemCreateInputs) {
        const created = await tx.orderItem.create({
          data: orderItemInput,
          include: {
            // Include to return the newly created item with its options
            food: true,
            options: {
              include: {
                option: true,
              },
            },
          },
        });
        createdOrderItems.push(created);
      }

      // Update the parent order's subtotal and total
      const updatedOrder = await tx.order.update({
        where: { id: existingOrder.id },
        data: {
          subtotal: { increment: totalAddedPrice },
          total: { increment: totalAddedPrice },
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

      // Returning the full updated order, which will now include the newly created items.
      return updatedOrder;
    });

    // Send the updated order as the response
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return res.status(404).json({ error: "Related record not found." });
      }
      return res.status(400).json({ error: error.message });
    }
    console.error("[Add Order Item Error]", error);
    return res.status(500).json({ error: "Failed to add items to order." });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
