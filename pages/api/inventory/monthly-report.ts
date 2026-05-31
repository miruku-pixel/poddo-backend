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
      StockLogType.TRANSFER_MANTOS,
      StockLogType.TRANSFER_MAUMBI,
      StockLogType.TRANSFER_TUMINTING,
      StockLogType.TRANSFER_17AGUSTUS,
      StockLogType.TRANSFER_PERKAMIL,
      StockLogType.ADJUST_OUT,
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
      if (log.type === StockLogType.INBOUND || log.type === StockLogType.ADJUST_IN || log.type === StockLogType.PROCESS_IN) {
        effect = log.quantity;
      } else if (deductionStockLogTypes.includes(log.type) || log.type === StockLogType.PROCESS_OUT) {
        // Apply negative effect for deduction types
        effect = -log.quantity;
      }
      openingBalanceForMonth += effect;
    });

    // 1. Fetch history logs and current stocks
    const history = await prisma.ingredientStockLog.findMany({
      where: {
        ingredientId: ingredientId,
        outletId: outletId,
        transactionDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      select: {
        quantity: true,
        type: true,
        transactionDate: true,
      },
      orderBy: { transactionDate: "asc" },
    });

    // 2. Aggregate daily data, now including prosesIn and prosesOut
    const dailyAggregates = new Map<string, {
      inbound: number;
      prosesOut: number;
      soldBoss: number;
      soldStaff: number;
      soldOther: number;
      prosesIn: number;
      discrepancy: number;
      adjustment: number; // Net adjustment (IN positive, OUT negative)
      transferNagoya: number;
      transferSeraya: number;
      transferBengkong: number;
      transferMalalayang: number;
      transferKleak: number;
      transferPaniki: number;
      transferItc: number;
      transferMantos: number;
      transferMaumbi: number;
      transferTuminting: number;
      transfer17Agustus: number;
      transferPerkamil: number;
    }>();

    // Initialize days
    for (let day = 1; day <= new Date(yearNum, monthNum, 0).getDate(); day++) {
      const dateKey = new Date(Date.UTC(yearNum, monthNum - 1, day))
        .toISOString()
        .split("T")[0];
      dailyAggregates.set(dateKey, {
  inbound: 0,
  prosesOut: 0,
  soldBoss: 0,
  soldStaff: 0,
  soldOther: 0,
  prosesIn: 0,
  discrepancy: 0,
  adjustment: 0,
  transferNagoya: 0,
  transferSeraya: 0,
  transferBengkong: 0,
  transferMalalayang: 0,
  transferKleak: 0,
  transferPaniki: 0,
  transferItc: 0,
  transferMantos: 0,
  transferMaumbi: 0,
  transferTuminting: 0,
  transfer17Agustus: 0,
  transferPerkamil: 0,
});
    }

    // Populate aggregation
    history.forEach((log) => {
      const dateKey = log.transactionDate.toISOString().split("T")[0];
      const agg = dailyAggregates.get(dateKey)!;
      switch (log.type) {
        case StockLogType.INBOUND:
          agg.inbound += log.quantity;
          break;
        case StockLogType.PROCESS_OUT:
          agg.prosesOut += log.quantity;
          break;
        case StockLogType.PROCESS_IN:
          agg.prosesIn += log.quantity;
          break;
        case StockLogType.OUTBOUND_BOSS:
          agg.soldBoss += log.quantity;
          break;
        case StockLogType.OUTBOUND_STAFF:
          agg.soldStaff += log.quantity;
          break;
        case StockLogType.OUTBOUND_NM:
          agg.soldOther += log.quantity;
          break;
        case StockLogType.ADJUST_IN:
          agg.adjustment += log.quantity; // Positive adjustment
          break;
        case StockLogType.ADJUST_OUT:
          agg.adjustment -= log.quantity; // Negative adjustment
          break;
        case StockLogType.DISCREPANCY:
          agg.discrepancy += log.quantity; // Discrepancy adjustment
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
        case StockLogType.TRANSFER_MANTOS:
          agg.transferMantos += log.quantity;
          break;
        case StockLogType.TRANSFER_MAUMBI:
          agg.transferMaumbi += log.quantity;
          break;
        case StockLogType.TRANSFER_TUMINTING:
          agg.transferTuminting += log.quantity;
          break;
        case StockLogType.TRANSFER_17AGUSTUS:
          agg.transfer17Agustus += log.quantity;
          break;
        case StockLogType.TRANSFER_PERKAMIL:
          agg.transferPerkamil += log.quantity;
          break;
        default:
          break;
      }
    });

    // 4. Build report rows with new proses columns
    const reportData: any[] = [];
    const sortedDateKeys = Array.from(dailyAggregates.keys()).sort();

    let runningBalance = openingBalanceForMonth;

    for (const dateKey of sortedDateKeys) {
      const agg = dailyAggregates.get(dateKey)!;
      const opening = runningBalance;
      const closing =
        opening +
        agg.inbound +
        agg.prosesIn -
        agg.prosesOut -
        agg.soldBoss -
        agg.soldStaff -
        agg.soldOther -
        agg.discrepancy +
        agg.adjustment -
        agg.transferNagoya -
        agg.transferSeraya -
        agg.transferBengkong -
        agg.transferMalalayang -
        agg.transferKleak -
        agg.transferPaniki -
        agg.transferItc -
        agg.transferMantos -
        agg.transferMaumbi -
        agg.transferTuminting -
        agg.transfer17Agustus -
        agg.transferPerkamil;

      reportData.push({
        date: dateKey,
        ingredient: ingredientName,
        outletId: outletId,
        openingBalance: Math.round(opening),
        inbound: Math.round(agg.inbound),
        prosesOut: Math.round(agg.prosesOut),
        soldBoss: Math.round(agg.soldBoss),
        soldStaff: Math.round(agg.soldStaff),
        soldOther: Math.round(agg.soldOther),
        prosesIn: Math.round(agg.prosesIn),
        adjustment: Math.round(agg.adjustment),
        discrepancy: Math.round(agg.discrepancy),
        transferNagoya: Math.round(agg.transferNagoya),
        transferSeraya: Math.round(agg.transferSeraya),
        transferBengkong: Math.round(agg.transferBengkong),
        transferMalalayang: Math.round(agg.transferMalalayang),
        transferKleak: Math.round(agg.transferKleak),
        transferPaniki: Math.round(agg.transferPaniki),
        transferItc: Math.round(agg.transferItc),
        transferMantos: Math.round(agg.transferMantos),
        transferMaumbi: Math.round(agg.transferMaumbi),
        transferTuminting: Math.round(agg.transferTuminting),
        transfer17Agustus: Math.round(agg.transfer17Agustus),
        transferPerkamil: Math.round(agg.transferPerkamil),

        closingBalance: Math.round(closing),
      });
      runningBalance = closing;
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