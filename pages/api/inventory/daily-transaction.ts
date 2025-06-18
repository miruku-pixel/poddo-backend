import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, StockLogType } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { user } = req as AuthenticatedRequest;
  const { ingredientId, quantity, type, note, date, outletId } = req.body;

  // Define allowed types for stock deduction
  const allowedDeductionTypes: StockLogType[] = [
    StockLogType.DISCREPANCY,
    StockLogType.TRANSFER_NAGOYA,
    StockLogType.TRANSFER_SERAYA,
    StockLogType.TRANSFER_BENGKONG,
    StockLogType.TRANSFER_ITC,
    StockLogType.TRANSFER_PANIKI,
    StockLogType.TRANSFER_KLEAK,
    StockLogType.TRANSFER_MALALAYANG,
    // Add other outbound types if they are to be handled here, e.g., OUTBOUND_NM, OUTBOUND_BOSS, OUTBOUND_STAFF
    // If those are handled by deductIngredientsForPaidOrder, they should not be included here.
  ];

  // Define all allowed transaction types for this API
  const allAllowedTransactionTypes: StockLogType[] = [
    StockLogType.INBOUND,
    ...allowedDeductionTypes,
  ];

  // Basic validation including outletId and updated allowed types
  if (
    !ingredientId ||
    typeof ingredientId !== "string" ||
    typeof quantity !== "number" ||
    quantity <= 0 ||
    !allAllowedTransactionTypes.includes(type as StockLogType) || // Validate type against all allowed
    !date ||
    typeof date !== "string" ||
    !outletId ||
    typeof outletId !== "string"
  ) {
    return res.status(400).json({
      error: `Invalid input: ingredientId, positive quantity, type (${allAllowedTransactionTypes.join(
        ", "
      )}), date, and outletId are required.`,
    });
  }

  try {
    const transactionDate = new Date(date as string);
    if (isNaN(transactionDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format provided." });
    }
    transactionDate.setUTCHours(0, 0, 0, 0); // Set to start of the selected day in UTC for consistent filtering
    const nextDay = new Date(transactionDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1); // Get start of next day in UTC

    // 1. Check for existing record for the selected date, ingredient, type, AND outlet
    const existingRecord = await prisma.ingredientStockLog.findFirst({
      where: {
        ingredientId: ingredientId,
        outletId: outletId,
        type: type as StockLogType,
        transactionDate: {
          gte: transactionDate,
          lt: nextDay,
        },
      },
    });

    if (existingRecord) {
      return res.status(409).json({
        error: `A ${type} record for this ingredient and outlet already exists for the selected date. Use PUT to edit.`,
        recordId: existingRecord.id,
      });
    }

    // Determine the actual stock change based on the type
    let stockChangeAmount = quantity;
    // Correctly check if the 'type' is one of the deduction types
    if (allowedDeductionTypes.includes(type as StockLogType)) {
      stockChangeAmount = -quantity; // A positive input for these types means deduction from stock
    }

    // 2. Create new record and update stock in a transaction
    const newLog = await prisma.$transaction(async (tx) => {
      // With the new Ingredient model, updating by ingredientId will correctly
      // update the stockQty for that specific ingredient at that specific outlet.
      const updatedIngredient = await tx.ingredient.update({
        where: { id: ingredientId }, // ingredientId is the ID of the specific ingredient-outlet pair
        data: {
          stockQty: { increment: stockChangeAmount },
          updatedAt: new Date(),
        },
      });

      // Optional: Prevent negative stock if the operation would make it negative
      // This check now correctly refers to the stockQty of the specific ingredient at the specific outlet.
      if (
        updatedIngredient.stockQty < 0 &&
        allowedDeductionTypes.includes(type as StockLogType)
      ) {
        throw new Error(
          `Insufficient stock for ${updatedIngredient.name} at this outlet. Cannot process ${type} of ${quantity} units, as it would result in negative stock.`
        );
      }

      // Create the new log entry, now including outletId
      return tx.ingredientStockLog.create({
        data: {
          ingredientId: ingredientId,
          outletId: outletId,
          quantity: quantity, // Store the original positive input quantity
          type: type as StockLogType,
          note:
            note ||
            `Manual ${type.toLowerCase()} by user ${
              user.id
            } at outlet ${outletId} for date ${date}`,
          transactionDate: transactionDate,
          createdAt: new Date(),
        },
      });
    });

    return res.status(201).json(newLog); // 201 Created
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Ingredient or Outlet not found." });
    }
    // Return custom error message if thrown by the transaction (e.g., "Insufficient stock")
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}
