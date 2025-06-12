// pages/api/reports/submit-daily-cash-reconciliation.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { PaymentType } from "@prisma/client";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use POST" });
  }

  try {
    const { outletId, date, cashDeposit, remarks } = req.body;

    // --- Input Validation ---
    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required." });
    }
    if (!date) {
      return res
        .status(400)
        .json({ error: "Date parameter is required (YYYY-MM-DD)." });
    }
    if (
      cashDeposit === undefined ||
      typeof cashDeposit !== "number" ||
      isNaN(cashDeposit)
    ) {
      return res
        .status(400)
        .json({ error: "Cash Deposit is required and must be a number." });
    }

    if (remarks !== undefined && typeof remarks !== "object") {
      return res.status(400).json({ error: "Remarks must be an object." });
    }

    // --- Date Handling ---
    const targetDate = new Date(date as string);
    if (isNaN(targetDate.getTime())) {
      return res
        .status(400)
        .json({ error: "Invalid date format. Please use YYYY-MM-DD." });
    }

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const previousDay = new Date(startOfDay);
    previousDay.setDate(startOfDay.getDate() - 1);
    previousDay.setHours(0, 0, 0, 0);

    // --- 1. Get Previous Day's Balance ---
    let previousDayBalance = 0;
    const previousDayReconciliation =
      await prisma.dailyCashReconciliation.findUnique({
        where: {
          outletId_date: {
            outletId: outletId as string,
            date: previousDay,
          },
        },
        select: {
          remainingBalance: true,
        },
      });

    if (previousDayReconciliation) {
      previousDayBalance = previousDayReconciliation.remainingBalance;
    }

    // --- 2. Calculate Current Day's CASH Revenue ---
    const cashRevenueForTodayRaw = await prisma.billing.groupBy({
      by: ["paymentType"],
      where: {
        outletId: outletId as string,
        paidAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        paymentType: PaymentType.CASH,
        order: {
          orderType: {
            name: {
              notIn: ["Boss", "Staff"],
            },
          },
        },
      },
      _sum: {
        total: true,
      },
    });

    const dailyCashRevenue = cashRevenueForTodayRaw[0]?._sum?.total ?? 0;

    // --- 3. Calculate Remaining Balance for Today ---
    const remainingBalance =
      previousDayBalance + dailyCashRevenue - cashDeposit;

    // --- 4. Upsert (Create or Update) DailyCashReconciliation Record ---
    const reconciliationRecord = await prisma.dailyCashReconciliation.upsert({
      where: {
        outletId_date: {
          outletId: outletId as string,
          date: startOfDay,
        },
      },
      update: {
        previousDayBalance: previousDayBalance,
        cashDeposit: cashDeposit,
        dailyCashRevenue: dailyCashRevenue,
        remainingBalance: remainingBalance,
        paymentRemarks: remarks,
        isLocked: true, // <--- NEW: Lock on update/submission
      },
      create: {
        outletId: outletId as string,
        date: startOfDay,
        previousDayBalance: previousDayBalance,
        cashDeposit: cashDeposit,
        dailyCashRevenue: dailyCashRevenue,
        remainingBalance: remainingBalance,
        paymentRemarks: remarks,
        isLocked: true, // <--- NEW: Lock on creation
      },
    });

    res.status(200).json({
      message: "Daily cash reconciliation submitted successfully.",
      data: reconciliationRecord,
    });
  } catch (error) {
    console.error("Error submitting daily cash reconciliation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
