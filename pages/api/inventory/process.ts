import { NextApiRequest, NextApiResponse } from "next";
//import prisma from "../../../lib/prisma";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { PrismaClient, StockLogType } from "@prisma/client";

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS method for CORS preflight requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Route request based on HTTP method
  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "POST") {
    return handlePost(req, res);
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}

// -------------------------------------------------------------
// GET: Fetch Conversion Logs History & Current Stocks for an Outlet
// -------------------------------------------------------------
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { outletId } = req.query;

  if (!outletId || typeof outletId !== "string") {
    return res.status(400).json({ error: "Missing or invalid query parameter: outletId." });
  }

  try {
    // 1. Fetch history logs
    const history = await prisma.ingredientProcess.findMany({
      where: {
        outletId,
      },
      include: {
        sourceIngredient: {
          select: { name: true, unit: true },
        },
        targetIngredient: {
          select: { name: true, unit: true },
        },
        processedBy: {
          select: { username: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // 2. Fetch current real-time stocks for the preview
    const ayamMentahRecord = await prisma.ingredient.findFirst({
      where: {
        outletId,
        name: {
          in: ["Ayam Mentah", "Ayam"],
        },
      },
      select: {
        stockQty: true,
        unit: true,
      },
    });

    const ayamUngkepRecord = await prisma.ingredient.findFirst({
      where: {
        outletId,
        name: "Ayam Ungkep",
      },
      select: {
        stockQty: true,
        unit: true,
      },
    });

    return res.status(200).json({
      history,
      stocks: {
        ayamMentah: ayamMentahRecord?.stockQty ?? 0,
        ayamMentahUnit: ayamMentahRecord?.unit ?? "pcs",
        ayamUngkep: ayamUngkepRecord?.stockQty ?? 0,
        ayamUngkepUnit: ayamUngkepRecord?.unit ?? "pcs",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/inventory/process API Error]", error);
    return res.status(500).json({ error: error.message || "Internal server error." });
  }
}

// -------------------------------------------------------------
// POST: Execute Conversion (Ayam Mentah -> Ayam Ungkep)
// -------------------------------------------------------------
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { user } = req as AuthenticatedRequest;
  const { outletId, quantity, notes } = req.body;

  // 1. Input Validation
  if (!outletId || typeof outletId !== "string") {
    return res.status(400).json({ error: "Missing or invalid outletId." });
  }

  if (typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be a positive number." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 2. Safely increment and lock the sequence counter for this outlet
      const counter = await tx.ingredientProcessNumberCounter.upsert({
        where: { outletId },
        update: { current: { increment: 1 } },
        create: { outletId, current: 1 },
      });

      // Format running number as 7 digits, e.g. "0000001"
      const processNo = counter.current.toString().padStart(7, "0");

      // 3. Dynamic lookup for "Ayam Mentah" (or "Ayam" in case the rename hasn't been executed yet)
      const ayamMentah = await tx.ingredient.findFirst({
        where: {
          outletId,
          name: {
            in: ["Ayam Mentah", "Ayam"],
          },
        },
      });

      // Dynamic lookup for "Ayam Ungkep"
      const ayamUngkep = await tx.ingredient.findFirst({
        where: {
          outletId,
          name: "Ayam Ungkep",
        },
      });

      if (!ayamMentah) {
        throw new Error(
          "Source ingredient 'Ayam Mentah' (or 'Ayam') not found at this outlet. Please check your inventory setup."
        );
      }

      if (!ayamUngkep) {
        throw new Error(
          "Target ingredient 'Ayam Ungkep' not found at this outlet. Please check your inventory setup."
        );
      }

      // 4. Verify raw stock availability
      if (ayamMentah.stockQty < quantity) {
        throw new Error(
          `Insufficient stock for ${ayamMentah.name}. Available: ${ayamMentah.stockQty} pcs, Requested: ${quantity} pcs.`
        );
      }

      // 5. Deduct raw stock (Ayam Mentah)
      const updatedSource = await tx.ingredient.update({
        where: { id: ayamMentah.id },
        data: {
          stockQty: { decrement: quantity },
          updatedAt: new Date(),
        },
      });

      // 6. Increment target stock (Ayam Ungkep) - Strict 1:1 conversion
      const updatedTarget = await tx.ingredient.update({
        where: { id: ayamUngkep.id },
        data: {
          stockQty: { increment: quantity },
          updatedAt: new Date(),
        },
      });

      // 7. Create PROCESS_OUT stock log for raw chicken
      await tx.ingredientStockLog.create({
        data: {
          ingredientId: ayamMentah.id,
          outletId,
          quantity,
          type: StockLogType.PROCESS_OUT,
          note: notes || `Processed ${quantity} pcs into Ayam Ungkep (Process No: ${processNo})`,
          transactionDate: new Date(),
          createdAt: new Date(),
        },
      });

      // 8. Create PROCESS_IN stock log for cooked chicken
      await tx.ingredientStockLog.create({
        data: {
          ingredientId: ayamUngkep.id,
          outletId,
          quantity,
          type: StockLogType.PROCESS_IN,
          note: notes || `Produced ${quantity} pcs from Ayam Mentah (Process No: ${processNo})`,
          transactionDate: new Date(),
          createdAt: new Date(),
        },
      });

      // 9. Log the process report record in the new IngredientProcess table
      const processLog = await tx.ingredientProcess.create({
        data: {
          processNo,
          outletId,
          sourceIngredientId: ayamMentah.id,
          targetIngredientId: ayamUngkep.id,
          quantity,
          notes: notes || null,
          processedById: user.id,
          createdAt: new Date(),
        },
        include: {
          sourceIngredient: {
            select: { name: true, unit: true },
          },
          targetIngredient: {
            select: { name: true, unit: true },
          },
          processedBy: {
            select: { username: true },
          },
        },
      });

      return {
        processLog,
        sourceStock: updatedSource.stockQty,
        targetStock: updatedTarget.stockQty,
      };
    });

    return res.status(201).json(result);
  } catch (error: any) {
    console.error("[POST /api/inventory/process API Error]", error);
    return res.status(error.message?.includes("Insufficient stock") || error.message?.includes("not found") ? 400 : 500).json({
      error: error.message || "Internal server error.",
    });
  }
}

// Ensure CORS is supported and wrap the route handler with authentication
export default applyMiddleware(handler, [corsMiddleware, withAuth]);

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}
