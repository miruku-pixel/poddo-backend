// pages/api/reports/daily-revenue.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { PaymentType } from "@prisma/client";

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
          gte: startOfDay,
          lte: endOfDay,
        },
        paymentType: {
          not: PaymentType.FOC,
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
              gte: startOfDay,
              lte: endOfDay,
            },
            paymentType: {
              not: PaymentType.FOC,
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

    const currentDayReconciliation =
      await prisma.dailyCashReconciliation.findUnique({
        where: {
          outletId_date: {
            outletId: outletId as string,
            date: startOfDay,
          },
        },
        select: {
          cashDeposit: true,
          remainingBalance: true,
          paymentRemarks: true,
          isLocked: true, // <--- NEW: Select isLocked
        },
      });

    if (currentDayReconciliation) {
      currentDayCashDeposit = currentDayReconciliation.cashDeposit;
      currentDayRemainingBalance = currentDayReconciliation.remainingBalance;
      currentDayPaymentRemarks = (currentDayReconciliation.paymentRemarks ||
        {}) as { [key: string]: string };
      isReconciliationLocked = currentDayReconciliation.isLocked; // <--- NEW: Set lock status
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
        reportDate: startOfDay.toISOString().split("T")[0],
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
