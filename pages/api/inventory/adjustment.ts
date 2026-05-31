import { NextApiRequest, NextApiResponse } from "next";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { PrismaClient, StockLogType } from "@prisma/client";

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "POST") {
    return handlePost(req, res);
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}

// -------------------------------------------------------------
// GET: Fetch Adjustment Logs History & All Active Ingredients
// -------------------------------------------------------------
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { outletId } = req.query;

  if (!outletId || typeof outletId !== "string") {
    return res.status(400).json({ error: "Missing or invalid query parameter: outletId." });
  }

  try {
    // 1. Fetch history logs
    const history = await prisma.ingredientAdjustment.findMany({
      where: { outletId },
      include: {
        ingredient: { select: { name: true, unit: true } },
        adjustedBy: { select: { username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      history,
    });
  } catch (error: any) {
    console.error("[GET /api/inventory/adjustment API Error]", error);
    return res.status(500).json({ error: error.message || "Internal server error." });
  }
}

// -------------------------------------------------------------
// POST: Execute Stock Adjustment
// -------------------------------------------------------------
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { user } = req as AuthenticatedRequest;
  console.log('Adjustment request body:', req.body);
  const { outletId, ingredientId, type, quantity, notes } = req.body;

  // 1. Input Validation
  if (!outletId || typeof outletId !== "string") {
    return res.status(400).json({ error: "Missing or invalid outletId." });
  }
  if (!ingredientId || typeof ingredientId !== "string") {
    return res.status(400).json({ error: "Missing or invalid ingredientId." });
  }
  if (type !== "IN" && type !== "OUT") {
    return res.status(400).json({ error: "Invalid adjustment type." });
  }
  if (typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be a positive number." });
  }

  // Validate outlet existence
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
  });
  if (!outlet) {
    return res.status(400).json({ error: "Invalid outletId: outlet not found." });
  }



  try {
    const result = await prisma.$transaction(async (tx) => {
      // 2. Safely increment and lock the sequence counter for this outlet
      const counter = await tx.ingredientAdjustmentNumberCounter.upsert({
        where: { outletId },
        update: { current: { increment: 1 } },
        create: { outletId, current: 1 },
      });

      // Format running number as 7 digits, e.g. "0000001"
      const adjustmentNo = counter.current.toString().padStart(7, "0");

      // 3. Lookup ingredient
      const ingredient = await tx.ingredient.findUnique({
        where: { id: ingredientId },
      });

      if (!ingredient) {
        throw new Error("Ingredient not found.");
      }

      // 4. Check stock for OUT adjustments
      if (type === "OUT" && ingredient.stockQty < quantity) {
        throw new Error(
          `Insufficient stock for ${ingredient.name}. Available: ${ingredient.stockQty} ${ingredient.unit}, Requested: ${quantity} ${ingredient.unit}.`
        );
      }

      // 5. Update stock quantity
      const updatedIngredient = await tx.ingredient.update({
        where: { id: ingredient.id },
        data: {
          stockQty: type === "IN" ? { increment: quantity } : { decrement: quantity },
          updatedAt: new Date(),
        },
      });

      // 6. Create stock log
      await tx.ingredientStockLog.create({
        data: {
          ingredientId: ingredient.id,
          outletId,
          quantity,
          type: type === "IN" ? StockLogType.ADJUST_IN : StockLogType.ADJUST_OUT,
          note: notes || `Stock Adjustment ${type} of ${quantity} ${ingredient.unit} (Adj No: ${adjustmentNo})`,
          transactionDate: new Date(),
          createdAt: new Date(),
        },
      });

      // 7. Log the adjustment record
      const adjustmentLog = await tx.ingredientAdjustment.create({
        data: {
          adjustmentNo,
          outletId,
          ingredientId: ingredient.id,
          type,
          quantity,
          notes: notes || null,
          adjustedById: user.id,
          createdAt: new Date(),
        },
        include: {
          ingredient: { select: { name: true, unit: true } },
          adjustedBy: { select: { username: true } },
        },
      });

      return {
        adjustmentLog,
        currentStock: updatedIngredient.stockQty,
      };
    });

    return res.status(201).json(result);
  } catch (error: any) {
    console.error("[POST /api/inventory/adjustment API Error]", error);
    console.error('[POST /api/inventory/adjustment] Error stack:', error.stack);
    return res.status(error.message?.includes('Insufficient stock') || error.message?.includes('not found') ? 400 : 500).json({
      error: error.message || 'Internal server error.',
    });
  }
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}
