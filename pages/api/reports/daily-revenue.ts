// pages/api/reports/daily-revenue.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { PaymentStatus, PaymentType } from "@prisma/client";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { outletId, date } = req.query;

    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required." });
    }
    if (!date) {
      return res
        .status(400)
        .json({ error: "Date parameter is required (YYYY-MM-DD)." });
    }

    // --- FIX: Robust Date Handling to ensure UTC consistency ---
    const dateString = date as string;
    const parts = dateString.split("-").map(Number);
    // Create Date object in UTC to avoid local timezone interpretation issues
    // Month is 0-indexed in JavaScript Date constructor, so subtract 1 from month part
    const targetDateUTC = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

    // startOfDayUTC is now guaranteed to be YYYY-MM-DD 00:00:00 UTC
    const startOfDayUTC = targetDateUTC;

    // Calculate endOfDayUTC by going to the start of the next day and subtracting 1 millisecond
    const endOfDayUTC = new Date(startOfDayUTC);
    endOfDayUTC.setUTCDate(startOfDayUTC.getUTCDate() + 1); // Move to the next day in UTC
    endOfDayUTC.setUTCMilliseconds(endOfDayUTC.getUTCMilliseconds() - 1); // Go back 1ms to get 23:59:59.999 of target day UTC

    // Calculate previousDayUTC by subtracting 1 day in UTC
    const previousDayUTC = new Date(startOfDayUTC);
    previousDayUTC.setUTCDate(startOfDayUTC.getUTCDate() - 1);

    const orderTypeDiscounts = await prisma.orderTypeDiscount.findMany({
      where: {
        outletId: outletId as string,
        isActive: true,
      },
    });

    const discountMap = new Map<string, number>();
    for (const discount of orderTypeDiscounts) {
      discountMap.set(discount.orderTypeId, discount.percentage);
    }

    const revenueByPaymentTypeRaw = await prisma.billing.groupBy({
      by: ["paymentType"],
      where: {
        outletId: outletId as string,
        paidAt: {
          gte: startOfDayUTC, // Use UTC dates for query
          lte: endOfDayUTC, // Use UTC dates for query
        },
        paymentType: {
          not: PaymentType.FOC,
        },
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
      orderBy: {
        paymentType: "asc",
      },
    });

    const totalRevenueByPaymentType = revenueByPaymentTypeRaw.map((entry) => ({
      paymentType: entry.paymentType,
      Revenue: entry._sum.total ?? 0,
    }));

    const TotalRevenue = totalRevenueByPaymentType.reduce(
      (sum, entry) => sum + entry.Revenue,
      0
    );

    const TotalRevenueExcldCash = totalRevenueByPaymentType
      .filter((entry) => entry.paymentType !== PaymentType.CASH)
      .reduce((sum, entry) => sum + entry.Revenue, 0);

    const relevantOrderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          outletId: outletId as string,
          Billing: {
            paidAt: {
              gte: startOfDayUTC, // Use UTC dates for query
              lte: endOfDayUTC, // Use UTC dates for query
            },
            paymentType: {
              not: PaymentType.FOC,
            },
            status: {
              not: PaymentStatus.VOID,
            },
          },
          orderType: {
            name: {
              notIn: ["Boss", "Staff"],
            },
          },
        },
        status: { not: "CANCELED" },
      },
      include: {
        food: {
          include: {
            foodCategory: true,
          },
        },
        order: {
          include: {
            orderType: true,
          },
        },
      },
    });

    let totalDrinkRevenue = 0;
    for (const item of relevantOrderItems) {
      if (item.food.foodCategory?.name === "Minuman") {
        let itemRevenue = item.totalPrice;
        const discountPercentage = discountMap.get(item.order.orderTypeId);
        if (discountPercentage !== undefined) {
          itemRevenue = item.totalPrice * (1 - discountPercentage);
        }
        totalDrinkRevenue += itemRevenue;
      }
    }

    let previousDayBalance = 0;
    let currentDayCashDeposit = 0;
    let currentDayRemainingBalance = 0;
    let currentDayPaymentRemarks: { [key: string]: string } = {};
    let isReconciliationLocked = false; // <--- NEW: Initialize lock status
    let submittedByCashierName: string | undefined = undefined;

    const previousDayReconciliation =
      await prisma.dailyCashReconciliation.findUnique({
        where: {
          outletId_date: {
            outletId: outletId as string,
            date: previousDayUTC,
          },
        },
        select: {
          remainingBalance: true,
        },
      });

    if (previousDayReconciliation) {
      previousDayBalance = previousDayReconciliation.remainingBalance;
    }

    const currentDayReconciliation =
      await prisma.dailyCashReconciliation.findUnique({
        where: {
          outletId_date: {
            outletId: outletId as string,
            date: startOfDayUTC,
          },
        },
        select: {
          cashDeposit: true,
          remainingBalance: true,
          paymentRemarks: true,
          isLocked: true, // <--- NEW: Select isLocked
          submittedByCashierName: true,
          adjustmentAmount: true,
        },
      });

    if (currentDayReconciliation) {
      currentDayCashDeposit = currentDayReconciliation.cashDeposit;
      currentDayRemainingBalance = currentDayReconciliation.remainingBalance;
      currentDayPaymentRemarks = (currentDayReconciliation.paymentRemarks ||
        {}) as { [key: string]: string };
      isReconciliationLocked = currentDayReconciliation.isLocked; // <--- NEW: Set lock status
      submittedByCashierName =
        currentDayReconciliation.submittedByCashierName ?? "";
    } else {
      const dailyCashRevenue =
        totalRevenueByPaymentType.find(
          (item) => item.paymentType === PaymentType.CASH
        )?.Revenue || 0;
      currentDayRemainingBalance =
        previousDayBalance + dailyCashRevenue - currentDayCashDeposit;
    }

    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId as string },
      select: { name: true },
    });

    res.status(200).json({
      meta: {
        reportDate: startOfDayUTC.toISOString().split("T")[0],
        generatedAt: new Date().toISOString(),
        outletName: outlet?.name || "Unknown Outlet",
      },
      summary: {
        totalRevenueByPaymentType: totalRevenueByPaymentType,
        TotalRevenueExcldCash: TotalRevenueExcldCash,
        TotalRevenue: TotalRevenue,
        totalDrinkRevenue: totalDrinkRevenue,
        cashReconciliation: {
          previousDayBalance: previousDayBalance,
          cashDeposit: currentDayCashDeposit,
          remainingBalance: currentDayRemainingBalance,
          isLocked: isReconciliationLocked, // <--- NEW: Include isLocked in response
          submittedByCashierName: submittedByCashierName,
          adjustmentAmount: currentDayReconciliation?.adjustmentAmount ?? 0,
        },
        paymentRemarks: currentDayPaymentRemarks,
      },
    });
  } catch (error) {
    console.error("Error generating Daily Revenue report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
