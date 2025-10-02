import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

// Define the required request body shape
interface CancelRequest {
  outletId: string;
  receiptNumber: string;
  orderNumber: string;
}

async function cancelBillingTransaction(
  outletId: string,
  receiptNumber: string,
  orderNumber: string
) {
  // 1. Find the Billing/Order to get the internal orderId
  const billingRecord = await prisma.billing.findUnique({
    where: {
      outletId_receiptNumber: {
        // Use the unique constraint for lookup
        outletId: outletId,
        receiptNumber: receiptNumber,
      },
      orderNumber: orderNumber, // Extra check for safety
    },
    select: {
      orderId: true,
      status: true,
    },
  });

  if (!billingRecord) {
    throw new Error("Billing record not found.");
  }

  // Prevent double-voiding
  if (billingRecord.status.toString() === "VOID") {
    return {
      message: "Billing is already Cancelled.",
      orderId: billingRecord.orderId,
    };
  }

  const orderId = billingRecord.orderId;

  // 2. Start the Transaction
  return await prisma.$transaction(async (tx) => {
    // --- A. Inventory Rollback ---

    // 2.1. Find all relevant IngredientStockLog records to be voided
    // The negative quantity in the log represents consumption (stock reduction)
    const stockLogs = await tx.ingredientStockLog.findMany({
      where: {
        outletId: outletId,
        orderId: orderId,
      },
    });

    if (stockLogs.length === 0) {
      console.warn(
        `No IngredientStockLog found for order ${orderId} to rollback.`
      );
    }

    // 2.2. Accumulate the total quantity to be returned per ingredientId
    const rollbackMap = stockLogs.reduce((acc, log) => {
      // Quantity is negative for consumption, so we use its absolute value to return to stock
      const quantityToReturn = Math.abs(log.quantity);

      acc[log.ingredientId] = (acc[log.ingredientId] || 0) + quantityToReturn;
      return acc;
    }, {} as Record<string, number>);

    // 2.3. Update Ingredient stockQty
    const ingredientUpdates = Object.entries(rollbackMap).map(
      ([ingredientId, quantity]) =>
        tx.ingredient.update({
          where: { id: ingredientId, outletId: outletId },
          data: {
            stockQty: {
              // Add the consumed quantity back to the stock
              increment: quantity,
            },
          },
        })
    );

    // Execute all ingredient updates in parallel within the transaction
    await Promise.all(ingredientUpdates);

    // --- B. Status Updates ---

    // 2.4. Update IngredientStockLog Type to VOID
    await tx.ingredientStockLog.updateMany({
      where: {
        outletId: outletId,
        orderId: orderId,
      },
      data: {
        type: "VOID" as any, // Cast required if StockLogType is an enum not containing 'VOID'
      },
    });

    // 2.5. Update Billing Status to VOID (using the unique constraint)
    const billingUpdate = tx.billing.update({
      where: {
        outletId_receiptNumber: {
          outletId: outletId,
          receiptNumber: receiptNumber,
        },
      },
      data: {
        status: "VOID" as any, // Cast required if PaymentStatus enum doesn't contain 'VOID'
      },
    });

    // 2.6. Update Order Status to VOID
    const orderUpdate = tx.order.update({
      where: { id: orderId },
      data: {
        status: "VOID" as any, // Cast required if OrderStatus enum doesn't contain 'VOID'
      },
    });

    // Execute status updates
    await Promise.all([billingUpdate, orderUpdate]);

    return {
      orderId: orderId,
      ingredientsRolledBack: rollbackMap,
      logsVoided: stockLogs.length,
    };
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { outletId, receiptNumber, orderNumber }: CancelRequest = req.body;

  if (!outletId || !receiptNumber || !orderNumber) {
    return res.status(400).json({
      error:
        "Missing required parameters: outletId, receiptNumber, and orderNumber.",
    });
  }

  try {
    const result = await cancelBillingTransaction(
      outletId,
      receiptNumber,
      orderNumber
    );
    return res.status(200).json({
      message: "Billing successfully cancelled and inventory rolled back.",
      details: result,
    });
  } catch (error) {
    console.error("Cancellation failed:", error);
    // Return 500 status for database/server-side failures
    return res.status(500).json({
      error: "Failed to complete billing cancellation due to a server error.",
    });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
