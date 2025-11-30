// pages/api/reports/submit-daily-cash-reconciliation.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { PaymentStatus, PaymentType } from "@prisma/client";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use POST" });
  }

  try {
    const {
      outletId,
      date,
      cashDeposit,
      remarks,
      submittedByCashierName,
      adjustment,
    } = req.body;

    const { user } = req as AuthenticatedRequest;
    const isAdmin = user.role === "ADMIN";

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

    if (
      typeof submittedByCashierName !== "string" ||
      submittedByCashierName.trim() === ""
    ) {
      return res
        .status(400)
        .json({ error: "Submitted By Cashier Name is required." });
    }

    if (remarks !== undefined && typeof remarks !== "object") {
      return res.status(400).json({ error: "Remarks must be an object." });
    }

    let validatedAdjustment = 0;
    if (adjustment !== undefined) {
      if (typeof adjustment !== "number" || isNaN(adjustment)) {
        return res.status(400).json({ error: "Adjustment must be a number." });
      }
      validatedAdjustment = adjustment;
    }

    // --- FIX: Robust Date Handling to ensure UTC consistency ---
    const dateString = date as string;
    const parts = dateString.split("-").map(Number);
    const targetDateUTC = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const startOfDayUTC = targetDateUTC;
    const previousDayUTC = new Date(startOfDayUTC);
    previousDayUTC.setUTCDate(startOfDayUTC.getUTCDate() - 1);

    // --- 1. Get Previous Day's Balance ---
    let previousDayBalance = 0;
    const previousDayReconciliation =
      await prisma.dailyCashReconciliation.findUnique({
        where: {
          outletId_date: {
            outletId: outletId as string,
            date: previousDayUTC, // Use UTC date for query
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
          gte: startOfDayUTC, // Use UTC dates for query
          lte: new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000 - 1), // End of day UTC
        },
        paymentType: PaymentType.CASH,
        status: {
          not: PaymentStatus.VOID,
        },
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
      previousDayBalance + dailyCashRevenue + validatedAdjustment - cashDeposit;

    // --- 4. Fetch existing record if updating ---
    const existing = await prisma.dailyCashReconciliation.findUnique({
      where: {
        outletId_date: {
          outletId: outletId as string,
          date: startOfDayUTC,
        },
      },
    });

    // --- 4. Upsert (Create or Update) DailyCashReconciliation Record ---
    const reconciliationRecord = await prisma.dailyCashReconciliation.upsert({
      where: {
        outletId_date: {
          outletId: outletId as string,
          date: startOfDayUTC, // Use UTC date for query
        },
      },
      update: {
        previousDayBalance: previousDayBalance,
        cashDeposit: cashDeposit,
        dailyCashRevenue: dailyCashRevenue,
        remainingBalance: remainingBalance,
        paymentRemarks: remarks,
        isLocked: true, // <--- NEW: Lock on update/submission
        adjustmentAmount: validatedAdjustment,
        submittedByCashierName:
          isAdmin && existing?.submittedByCashierName
            ? existing.submittedByCashierName
            : submittedByCashierName,
      },
      create: {
        outletId: outletId as string,
        date: startOfDayUTC, // Use UTC date for creation
        previousDayBalance: previousDayBalance,
        cashDeposit: cashDeposit,
        dailyCashRevenue: dailyCashRevenue,
        remainingBalance: remainingBalance,
        paymentRemarks: remarks,
        isLocked: true, // <--- NEW: Lock on creation
        submittedByCashierName: submittedByCashierName, // Store the cashier's name
        adjustmentAmount: validatedAdjustment,
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
