import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { PaymentStatus } from "@prisma/client";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { outletId, startDate, endDate } = req.query;

    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required" });
    }

    const start = startDate
      ? new Date(new Date(startDate as string).setHours(0, 0, 0, 0))
      : new Date(new Date().setDate(new Date().getDate() - 7));
    const end = endDate
      ? new Date(new Date(endDate as string).setHours(23, 59, 59, 999))
      : new Date();

    // Fetch active OrderTypeDiscounts for the given outlet
    const orderTypeDiscounts = await prisma.orderTypeDiscount.findMany({
      where: {
        outletId: outletId as string,
        isActive: true,
      },
    });

    // Create a map for quick lookup: orderTypeId -> discountPercentage
    const discountMap = new Map<string, number>();
    for (const discount of orderTypeDiscounts) {
      discountMap.set(discount.orderTypeId, discount.percentage);
    }

    // === Exclude "Boss" and "Staff" OrderType ===
    const billings = await prisma.billing.findMany({
      where: {
        outletId: outletId as string,
        paidAt: {
          gte: start,
          lte: end,
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
      select: {
        orderId: true,
        total: true,
        discount: true,
      },
    });

    const totalTransactions = billings.length;
    const totalRevenue = billings.reduce((sum, b) => sum + b.total, 0);
    const totalDiscount = billings.reduce((sum, b) => sum + b.discount, 0);

    const revenueByOrderType = await prisma.billing.groupBy({
      by: ["orderId"],
      where: {
        outletId: outletId as string,
        paidAt: {
          gte: start,
          lte: end,
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
    });

    // Get corresponding OrderTypes
    const orders = await prisma.order.findMany({
      where: {
        id: {
          in: revenueByOrderType.map((r) => r.orderId),
        },
      },
      include: {
        orderType: true,
      },
    });

    const orderTypeRevenueMap: { [key: string]: number } = {};

    for (const entry of revenueByOrderType) {
      const order = orders.find((o) => o.id === entry.orderId);
      if (!order) continue;

      const name = order.orderType.name;
      if (!orderTypeRevenueMap[name]) {
        orderTypeRevenueMap[name] = 0;
      }
      orderTypeRevenueMap[name] += entry._sum.total ?? 0;
    }

    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId as string },
      select: { name: true },
    });

    const orderIds = billings.map((b) => b.orderId);

    const orderItems = await prisma.orderItem.findMany({
      where: {
        orderId: { in: orderIds },
        status: { not: "CANCELED" },
      },
      include: {
        food: {
          include: {
            foodCategory: true, // Include foodCategory here
          },
        },
        order: {
          include: {
            orderType: true,
          },
        },
      },
    });

    type FoodOrderTypeKey = string; // `$
    const foodOrderTypeSalesMap: {
      [key: FoodOrderTypeKey]: {
        foodName: string;
        foodCategory: string; // Add foodCategory to the map
        orderType: string;
        quantity: number;
        revenue: number;
      };
    } = {};
    for (const item of orderItems) {
      const foodId = item.foodId;
      const foodName = item.food.name;
      const foodCategory = item.food.foodCategory?.name; // Get the food category name
      const orderTypeId = item.order.orderTypeId;
      const orderType = item.order.orderType.name;
      const key = `${foodId}_${orderType}_${foodCategory}`; // Include foodCategory in the key

      if (!foodOrderTypeSalesMap[key]) {
        foodOrderTypeSalesMap[key] = {
          foodName,
          foodCategory: foodCategory || "Unknown Category", // Default to "Unknown Category" if not available
          orderType,
          quantity: 0,
          revenue: 0,
        };
      }
      // Calculate adjusted revenue
      let adjustedRevenue = item.totalPrice;
      const discountPercentage = discountMap.get(orderTypeId);

      if (discountPercentage !== undefined) {
        adjustedRevenue = item.totalPrice * (1 - discountPercentage);
      }

      foodOrderTypeSalesMap[key].quantity += item.quantity;
      foodOrderTypeSalesMap[key].revenue += adjustedRevenue;
    }

    // Now, group by food category
    const foodSalesByCategoryAndOrderType: {
      [category: string]: {
        foodName: string;
        orderTypeSales: {
          [orderType: string]: {
            quantity: number;
            revenue: number;
          };
        };
      }[];
    } = {};

    for (const item of Object.values(foodOrderTypeSalesMap)) {
      const { foodCategory, foodName, orderType, quantity, revenue } = item;

      if (!foodSalesByCategoryAndOrderType[foodCategory]) {
        foodSalesByCategoryAndOrderType[foodCategory] = [];
      }

      let foodEntry = foodSalesByCategoryAndOrderType[foodCategory].find(
        (entry) => entry.foodName === foodName
      );

      if (!foodEntry) {
        foodEntry = {
          foodName,
          orderTypeSales: {},
        };
        foodSalesByCategoryAndOrderType[foodCategory].push(foodEntry);
      }

      foodEntry.orderTypeSales[orderType] = { quantity, revenue };
    }

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
        totalTransactions,
        totalRevenue,
        totalDiscount,
      },
      revenueByOrderType: Object.entries(orderTypeRevenueMap).map(
        ([orderType, revenue]) => ({ orderType, revenue })
      ),
      foodSalesByCategoryAndOrderType, // This will be your new structured data
    });
  } catch (error) {
    console.error("Error generating Sales Summary report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
