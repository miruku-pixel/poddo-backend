import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, StockLogType, OrderStatus } from "@prisma/client"; // Ensure StockLogType is updated via Prisma migration
import { withAuth } from "../../../middleware/authMiddleware"; // Adjust path as needed
import { corsMiddleware } from "../../../middleware/cors"; // Adjust path as needed

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS method for CORS preflight requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use GET" });
  }

  // Added outletId to query parameters
  const { month, year, ingredientId, outletId } = req.query;

  if (
    !month ||
    !year ||
    !ingredientId ||
    !outletId || // Validate outletId
    typeof month !== "string" ||
    typeof year !== "string" ||
    typeof ingredientId !== "string" ||
    typeof outletId !== "string" // Validate outletId type
  ) {
    return res.status(400).json({
      error:
        "Missing or invalid query parameters: month (number), year (number), ingredientId (UUID), outletId (UUID).",
    });
  }

  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  if (
    isNaN(monthNum) ||
    monthNum < 1 ||
    monthNum > 12 ||
    isNaN(yearNum) ||
    yearNum < 2000
  ) {
    return res
      .status(400)
      .json({ error: "Invalid month (1-12) or year (e.g., 2023) format." });
  }

  try {
    const startOfMonth = new Date(Date.UTC(yearNum, monthNum - 1, 1));
    const endOfMonth = new Date(
      Date.UTC(yearNum, monthNum, 0, 23, 59, 59, 999)
    );

    // Fetch the ingredient name once (Ingredient model does not have outletId)
    const ingredient = await prisma.ingredient.findUnique({
      where: { id: ingredientId },
      select: { name: true },
    });

    if (!ingredient) {
      return res.status(404).json({ error: "Ingredient not found." });
    }
    const ingredientName = ingredient.name;

    // Fetch outlet name for the report
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { name: true },
    });

    if (!outlet) {
      return res.status(404).json({ error: "Outlet not found." });
    }
    const outletName = outlet.name;

    // Define all deduction-based StockLogTypes, including all TRANSFER types
    // These types, when logged, represent a decrease in stock.
    const deductionStockLogTypes: StockLogType[] = [
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

    // 1. Calculate the Opening Balance for the entire reporting month
    // This calculation MUST include all stock log types to be accurate.
    const balanceBeforeMonthLogs = await prisma.ingredientStockLog.findMany({
      where: {
        ingredientId: ingredientId,
        outletId: outletId, // Filter by outletId (assuming IngredientStockLog now has this field)
        transactionDate: {
          lt: startOfMonth, // All logs before the 1st day of the requested month
        },
      },
      select: {
        quantity: true,
        type: true,
        transactionDate: true, // Include transactionDate for debugging
      },
    });

    let openingBalanceForMonth = 0;

    balanceBeforeMonthLogs.forEach((log) => {
      let effect = 0;
      if (log.type === StockLogType.INBOUND) {
        effect = log.quantity;
      } else if (deductionStockLogTypes.includes(log.type)) {
        // Apply negative effect for deduction types
        effect = -log.quantity;
      }
      openingBalanceForMonth += effect;
    });

    // 2. Fetch ALL relevant StockLogs for the requested month
    // This includes INBOUND, all OUTBOUND types, DISCREPANCY, and all TRANSFER types.
    const monthlyStockLogs = await prisma.ingredientStockLog.findMany({
      where: {
        ingredientId: ingredientId,
        outletId: outletId, // Filter by outletId
        transactionDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        type: {
          // Include all relevant StockLogType enum values here
          in: Object.values(StockLogType),
        },
      },
      orderBy: {
        transactionDate: "asc",
      },
      select: {
        quantity: true,
        type: true,
        transactionDate: true,
      },
    });

    // 3. Aggregate all daily data based on monthlyStockLogs
    const dailyAggregates = new Map<
      string,
      {
        inbound: number;
        soldBoss: number;
        soldStaff: number;
        soldOther: number;
        discrepancy: number;
        transferNagoya: number;
        transferSeraya: number;
        transferBengkong: number;
        transferMalalayang: number;
        transferKleak: number;
        transferPaniki: number;
        transferItc: number;
      }
    >();

    // Initialize all days of the month in the aggregate map to ensure they appear in the report
    for (let day = 1; day <= new Date(yearNum, monthNum, 0).getDate(); day++) {
      const currentDate = new Date(Date.UTC(yearNum, monthNum - 1, day));
      const dateKey = currentDate.toISOString().split("T")[0];
      dailyAggregates.set(dateKey, {
        inbound: 0,
        soldBoss: 0,
        soldStaff: 0,
        soldOther: 0,
        discrepancy: 0,
        transferNagoya: 0,
        transferSeraya: 0,
        transferBengkong: 0,
        transferMalalayang: 0,
        transferKleak: 0,
        transferPaniki: 0,
        transferItc: 0,
      });
    }

    // Process ALL monthlyStockLogs based on their type to populate dailyAggregates
    monthlyStockLogs.forEach((log) => {
      const dateKey = log.transactionDate.toISOString().split("T")[0];
      const agg = dailyAggregates.get(dateKey)!; // Guaranteed to exist due to initialization

      switch (log.type) {
        case StockLogType.INBOUND:
          agg.inbound += log.quantity;
          break;
        case StockLogType.OUTBOUND_BOSS:
          agg.soldBoss += log.quantity;
          break;
        case StockLogType.OUTBOUND_STAFF:
          agg.soldStaff += log.quantity;
          break;
        case StockLogType.OUTBOUND_NM:
          agg.soldOther += log.quantity; // Non-Manager / Normal Sales
          break;
        case StockLogType.DISCREPANCY:
          agg.discrepancy += log.quantity;
          break;
        case StockLogType.TRANSFER_NAGOYA:
          agg.transferNagoya += log.quantity;
          break;
        case StockLogType.TRANSFER_SERAYA:
          agg.transferSeraya += log.quantity;
          break;
        case StockLogType.TRANSFER_BENGKONG:
          agg.transferBengkong += log.quantity;
          break;
        case StockLogType.TRANSFER_MALALAYANG:
          agg.transferMalalayang += log.quantity;
          break;
        case StockLogType.TRANSFER_KLEAK:
          agg.transferKleak += log.quantity;
          break;
        case StockLogType.TRANSFER_PANIKI:
          agg.transferPaniki += log.quantity;
          break;
        case StockLogType.TRANSFER_ITC:
          agg.transferItc += log.quantity;
          break;
        default:
          console.warn(
            `[Monthly Report API] Unhandled StockLogType: ${log.type} for quantity: ${log.quantity} on ${dateKey}`
          );
      }
    });

    // 4. Build the final report data, iterating through each day of the month
    const reportData: any[] = [];
    const sortedDateKeys = Array.from(dailyAggregates.keys()).sort();

    let currentRunningClosingBalance = openingBalanceForMonth;

    for (const dateKey of sortedDateKeys) {
      const dailyStats = dailyAggregates.get(dateKey)!; // Guaranteed to exist

      const openingBalanceForCurrentDay = currentRunningClosingBalance;

      // Calculate closing balance for the current day based on all aggregated types
      // All OUTBOUND and TRANSFER types are deductions
      const closingBalanceForCurrentDay =
        openingBalanceForCurrentDay +
        dailyStats.inbound -
        dailyStats.soldBoss -
        dailyStats.soldStaff -
        dailyStats.soldOther -
        dailyStats.discrepancy -
        dailyStats.transferNagoya -
        dailyStats.transferSeraya -
        dailyStats.transferBengkong -
        dailyStats.transferMalalayang -
        dailyStats.transferKleak -
        dailyStats.transferPaniki -
        dailyStats.transferItc;

      reportData.push({
        date: dateKey,
        ingredient: ingredientName,
        outletId: outletId, // Include outletId in the report data
        openingBalance: Math.round(openingBalanceForCurrentDay), // Round to nearest whole number
        inbound: Math.round(dailyStats.inbound), // Round to nearest whole number
        soldBoss: Math.round(dailyStats.soldBoss), // Round to nearest whole number
        soldStaff: Math.round(dailyStats.soldStaff), // Round to nearest whole number
        soldOther: Math.round(dailyStats.soldOther), // Round to nearest whole number
        discrepancy: Math.round(dailyStats.discrepancy), // Round to nearest whole number
        transferNagoya: Math.round(dailyStats.transferNagoya), // Round to nearest whole number
        transferSeraya: Math.round(dailyStats.transferSeraya), // Round to nearest whole number
        transferBengkong: Math.round(dailyStats.transferBengkong), // Round to nearest whole number
        transferMalalayang: Math.round(dailyStats.transferMalalayang), // Round to nearest whole number
        transferKleak: Math.round(dailyStats.transferKleak), // Round to nearest whole number
        transferPaniki: Math.round(dailyStats.transferPaniki), // Round to nearest whole number
        transferItc: Math.round(dailyStats.transferItc), // Round to nearest whole number
        closingBalance: Math.round(closingBalanceForCurrentDay), // Round to nearest whole number
      });

      currentRunningClosingBalance = closingBalanceForCurrentDay;
    }

    res.status(200).json({
      outletName: outletName, // Include outlet name in the response
      reportData: reportData,
    });
  } catch (error: any) {
    console.error("[GET Monthly Inventory Report API Error]", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Ingredient or Outlet not found." });
    }
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}

// Apply middleware to the handler (assuming this function is defined elsewhere or copied from your project)
export default applyMiddleware(handler, [corsMiddleware, withAuth]);

// Helper function to apply middleware (copy from your project if different)
function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}
