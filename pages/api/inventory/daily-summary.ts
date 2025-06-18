import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, StockLogType } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Added outletId to the destructured query parameters
  const { ingredientId, type, date, outletId } = req.query;

  // Define all allowed StockLogType values for this API endpoint
  const allAllowedStockLogTypes: StockLogType[] = [
    StockLogType.INBOUND,
    StockLogType.DISCREPANCY,
    StockLogType.OUTBOUND_NM,
    StockLogType.OUTBOUND_BOSS,
    StockLogType.OUTBOUND_STAFF,
    StockLogType.TRANSFER_NAGOYA,
    StockLogType.TRANSFER_SERAYA,
    StockLogType.TRANSFER_BENGKONG,
    StockLogType.TRANSFER_MALALAYANG,
    StockLogType.TRANSFER_KLEAK,
    StockLogType.TRANSFER_PANIKI,
    StockLogType.TRANSFER_ITC,
  ];

  if (
    !ingredientId ||
    typeof ingredientId !== "string" ||
    !type ||
    !allAllowedStockLogTypes.includes(type as StockLogType) || // Updated to include all new StockLogTypes
    !date ||
    typeof date !== "string" ||
    !outletId ||
    typeof outletId !== "string"
  ) {
    return res.status(400).json({
      error: `Missing or invalid query parameters: ingredientId (string), type (${allAllowedStockLogTypes.join(
        " | "
      )}), date (string), and outletId (string).`,
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

    const record = await prisma.ingredientStockLog.findFirst({
      where: {
        ingredientId: ingredientId,
        outletId: outletId, // Filter by outletId
        type: type as StockLogType, // Cast to enum type
        transactionDate: {
          // Use the new transactionDate field for filtering
          gte: transactionDate,
          lt: nextDay,
        },
      },
      select: {
        id: true,
        outletId: true,
        quantity: true,
        note: true,
        transactionDate: true,
      },
    });

    if (record) {
      return res.status(200).json(record);
    } else {
      return res.status(200).json(null); // Return null if no record for today
    }
  } catch (error: any) {
    console.error("[Get Daily Inventory Summary API Error]", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Ingredient or Outlet not found." });
    }
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}
