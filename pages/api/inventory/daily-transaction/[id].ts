import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, StockLogType } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../../../middleware/authMiddleware"; // Adjust path as needed
import { corsMiddleware } from "../../../../middleware/cors"; // Adjust path as needed

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS method for CORS preflight requests
  if (req.method === "OPTIONS") {
    // The corsMiddleware should set the appropriate headers.
    // We just need to respond with 200 OK for the preflight.
    return res.status(200).end();
  }

  // Proceed with PUT method logic
  if (req.method !== "PUT") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query; // This `id` is the IngredientStockLog ID
  const { quantity, note, outletId } = req.body;
  const { user } = req as AuthenticatedRequest;

  // Define types that result in a stock deduction (negative quantity effect)
  const deductionStockLogTypes: StockLogType[] = [
    StockLogType.DISCREPANCY,
    StockLogType.TRANSFER_NAGOYA,
    StockLogType.TRANSFER_SERAYA,
    StockLogType.TRANSFER_BENGKONG,
    StockLogType.TRANSFER_MALALAYANG,
    StockLogType.TRANSFER_KLEAK,
    StockLogType.TRANSFER_PANIKI,
    StockLogType.TRANSFER_ITC,
  ];

  if (
    !id ||
    typeof id !== "string" ||
    typeof quantity !== "number" ||
    quantity <= 0 || // Quantity in request body should always be positive
    !outletId ||
    typeof outletId !== "string"
  ) {
    return res.status(400).json({
      error:
        "Invalid input: ID (string), positive quantity (number), and outletId (string) are required.",
    });
  }

  try {
    const updatedLog = await prisma.$transaction(async (tx) => {
      // 1. Fetch the existing log record to get its old quantity, type, and ingredientId.
      // Filter by outletId to ensure the log belongs to the specified outlet.
      const existingLog = await tx.ingredientStockLog.findUnique({
        where: {
          id: id,
          outletId: outletId, // Filter by outletId
        },
        select: {
          id: true,
          quantity: true, // Old quantity
          type: true,
          ingredientId: true,
          transactionDate: true,
          ingredient: { select: { name: true, stockQty: true, unit: true } }, // Include ingredient details for checks/notes
        },
      });

      if (!existingLog) {
        // If the record is not found for the given ID and outletId, or outletId mismatch
        throw new Error(
          "Daily transaction record not found or does not belong to the specified outlet."
        );
      }

      // Check if the type is one that CANNOT be manually edited (e.g., automated OUTBOUND types)
      const nonEditableTypes: StockLogType[] = [
        StockLogType.OUTBOUND_NM,
        StockLogType.OUTBOUND_BOSS,
        StockLogType.OUTBOUND_STAFF,
      ];
      if (nonEditableTypes.includes(existingLog.type)) {
        throw new Error(
          `${existingLog.type} transactions cannot be manually edited via this endpoint.`
        );
      }

      // 2. Calculate the net effect of the old log entry on ingredient's stock
      let netEffectOfOldLog = 0;
      if (existingLog.type === StockLogType.INBOUND) {
        netEffectOfOldLog = existingLog.quantity; // Old INBOUND added this much
      } else if (deductionStockLogTypes.includes(existingLog.type)) {
        netEffectOfOldLog = -existingLog.quantity; // Old deduction type deducted this much
      }

      // 3. Calculate the net effect of the new quantity on ingredient's stock
      let netEffectOfNewLog = 0;
      if (existingLog.type === StockLogType.INBOUND) {
        netEffectOfNewLog = quantity; // New INBOUND will add this much
      } else if (deductionStockLogTypes.includes(existingLog.type)) {
        netEffectOfNewLog = -quantity; // New deduction type will deduct this much
      }

      // 4. Calculate the difference to apply to the Ingredient's stockQty
      // This is: (what the new log *should* contribute) - (what the old log *did* contribute)
      const stockAdjustmentDelta = netEffectOfNewLog - netEffectOfOldLog;

      // 5. Pre-check for negative stock BEFORE applying the update
      // This refers to the current stockQty of the specific ingredient at the specific outlet
      if (existingLog.ingredient.stockQty + stockAdjustmentDelta < 0) {
        throw new Error(
          `Insufficient stock for ${existingLog.ingredient.name} at this outlet (${existingLog.ingredient.stockQty} ${existingLog.ingredient.unit} available). Adjustment would result in negative stock.`
        );
      }

      // 6. Update the Ingredient's stockQty for the specific ingredient-outlet pair
      const updatedIngredient = await tx.ingredient.update({
        where: { id: existingLog.ingredientId }, // The ingredientId here is for the specific ingredient record at this outlet
        data: {
          stockQty: { increment: stockAdjustmentDelta },
          updatedAt: new Date(), // Update the Ingredient's updatedAt timestamp
        },
      });

      // 7. Update the IngredientStockLog record itself
      // DO NOT update transactionDate here. It should remain fixed to the day the record represents.
      return tx.ingredientStockLog.update({
        where: { id: id },
        data: {
          quantity: quantity, // Store the new positive input quantity
          note:
            note ||
            `Manual ${existingLog.type.toLowerCase()} updated by user ${
              user.id
            } at outlet ${outletId} for ${
              existingLog.transactionDate.toISOString().split("T")[0]
            }`, // Include original date and outletId in note for clarity
          updatedAt: new Date(), // Update the log entry's updatedAt timestamp
        },
      });
    });

    return res.status(200).json(updatedLog);
  } catch (error: any) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ error: "Record, Ingredient, or Outlet not found." });
    }
    console.error("[PUT Daily Inventory Transaction API Error]", error);
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
