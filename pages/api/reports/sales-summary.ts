import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma"; // Adjust path as needed
import { PaymentType } from "@prisma/client";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      outletId,
      startDate,
      endDate,
      paymentType,
      orderType,
      limit = 100,
      offset = 0,
    } = req.query;

    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required" });
    }

    const start = startDate
      ? new Date(new Date(startDate as string).setHours(0, 0, 0, 0))
      : new Date(new Date().setDate(new Date().getDate() - 7));
    const end = endDate
      ? new Date(new Date(endDate as string).setHours(23, 59, 59, 999))
      : new Date();

    const billings = await prisma.billing.findMany({
      where: {
        outletId: outletId as string,
        paidAt: {
          gte: start,
          lte: end,
        },
        ...(paymentType && {
          paymentType: paymentType as PaymentType,
        }),
        ...(orderType && {
          order: {
            orderType: {
              name: orderType as string,
            },
          },
        }),
      },
      include: {
        order: {
          include: {
            orderType: true,
            items: {
              include: {
                food: {
                  include: {
                    foodCategory: true, // ← Add this
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { paidAt: "asc" }, // ← first sort by paidAt
        { orderNumber: "asc" }, // ← then sort by orderNumber
      ],
      skip: Number(offset),
      take: Number(limit),
    });

    // Aggregates
    let totalRevenue = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    let totalAmountPaid = 0;
    let totalChangeGiven = 0;

    const salesByPaymentType: Record<string, number> = {};
    const salesByOrderType: Record<string, number> = {};
    const categorizedFoodSales: Record<string, Record<string, any>> = {};

    const detailed = billings.map((b) => {
      totalRevenue += b.total;
      totalTax += b.tax;
      totalDiscount += b.discount;
      totalAmountPaid += b.amountPaid;
      totalChangeGiven += b.changeGiven;

      const paymentKey = b.paymentType;
      const orderKey = b.order.orderType?.name || "UNKNOWN";

      salesByPaymentType[paymentKey] =
        (salesByPaymentType[paymentKey] || 0) + b.total;
      salesByOrderType[orderKey] = (salesByOrderType[orderKey] || 0) + b.total;

      // Item-level aggregation
      billings.forEach((b) => {
        const orderType = b.order.orderType?.name || "UNKNOWN";

        b.order.items.forEach((item) => {
          const category = item.food.foodCategory?.name || "Uncategorized";
          const foodId = item.foodId;
          const foodName = item.food.name;
          const quantity = item.quantity;
          const total = item.totalPrice;

          if (!categorizedFoodSales[category]) {
            categorizedFoodSales[category] = {};
          }

          if (!categorizedFoodSales[category][foodId]) {
            categorizedFoodSales[category][foodId] = {
              foodName,
              total: { qty: 0, total: 0 },
            };
          }

          const foodEntry = categorizedFoodSales[category][foodId];

          // Track each order type dynamically
          if (!foodEntry[orderType]) {
            foodEntry[orderType] = { qty: 0, total: 0 };
          }

          foodEntry[orderType].qty += quantity;
          foodEntry[orderType].total += total;

          foodEntry.total.qty += quantity;
          foodEntry.total.total += total;
        });
      });

      // Now convert into final structure
      const foodSales: Record<string, any[]> = {};
      for (const [category, foodMap] of Object.entries(categorizedFoodSales)) {
        foodSales[category] = Object.values(foodMap);
      }

      return {
        billingId: b.id,
        orderNumber: b.orderNumber,
        receiptNumber: b.receiptNumber,
        paidAt: b.paidAt,
        subtotal: b.subtotal,
        discount: b.discount,
        tax: b.tax,
        total: b.total,
        amountPaid: b.amountPaid,
        changeGiven: b.changeGiven,
        paymentType: b.paymentType,
        orderType: orderKey,
      };
    });

    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId as string },
    });

    res.status(200).json({
      meta: {
        reportPeriod: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        },
        generatedAt: new Date().toISOString(),
        outletName: outlet?.name || "Unknown Outlet",
      },
      summary: {
        totalTransactions: billings.length,
        totalRevenue,
        totalTax,
        totalDiscount,
        totalAmountPaid,
        totalChangeGiven,
        salesByPaymentType,
        salesByOrderType,
      },
      data: detailed,
      foodSales: {},
      foodSalesByCategory: categorizedFoodSales,
    });
  } catch (error) {
    console.error("Error generating sales report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
