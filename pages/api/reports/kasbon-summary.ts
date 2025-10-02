import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, PaymentStatus } from "@prisma/client";
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

  // Destructure query parameters
  const { startDate, endDate, outletId } = req.query;

  // Validate required parameters
  if (
    !startDate ||
    typeof startDate !== "string" ||
    !endDate ||
    typeof endDate !== "string" ||
    !outletId ||
    typeof outletId !== "string"
  ) {
    return res.status(400).json({
      error:
        "Missing or invalid query parameters: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), and outletId (UUID) are required.",
    });
  }

  try {
    // Parse start and end dates, setting time to start/end of day in UTC for consistent filtering
    const start = new Date(new Date(startDate).setUTCHours(0, 0, 0, 0));
    const end = new Date(new Date(endDate).setUTCHours(23, 59, 59, 999));

    // Validate if dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res
        .status(400)
        .json({ error: "Invalid date format provided. Use YYYY-MM-DD." });
    }

    // Fetch billing records for KASBON orders within the specified date range and outlet
    const kasbonBillings = await prisma.billing.findMany({
      where: {
        outletId: outletId,
        paidAt: {
          gte: start,
          lte: end,
        },
        status: {
          not: PaymentStatus.VOID,
        },
        order: {
          // Filter by the related Order's OrderType name
          orderType: {
            name: "Kasbon", // Specifically filter for "KASBON" orders
          },
        },
      },
      select: {
        paidAt: true, // Billing Date
        orderNumber: true, // Order Number (copied to Billing)
        remark: true, // Billing Remark
        amountPaid: true, // Amount Paid
        order: {
          select: {
            remark: true, // Order Remark
            items: {
              // Include order items
              select: {
                quantity: true,
                food: {
                  select: {
                    name: true, // Select food name
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        paidAt: "asc", // Order by billing date
      },
    });

    // Define the interface for a single KASBON report entry (for clarity in mapping)
    interface OrderItemDisplay {
      foodName: string;
      quantity: number;
    }

    interface KasbonReportEntry {
      billingDate: string;
      orderNumber: string;
      orderRemark: string | null;
      billingRemark: string | null;
      amountPaid: number;
      items?: OrderItemDisplay[]; // Added optional items array
    }

    // Format the response data
    const formattedReport: KasbonReportEntry[] = kasbonBillings.map(
      (billing) => ({
        billingDate: billing.paidAt.toISOString().split("T")[0], // Format to YYYY-MM-DD
        orderNumber: billing.orderNumber,
        orderRemark: billing.order?.remark || null, // Use optional chaining, default to null if not present
        billingRemark: billing.remark || null, // Default to null if not present
        amountPaid: billing.amountPaid,
        items:
          billing.order?.items.map((item) => ({
            // Map order items to the new structure
            foodName: item.food?.name || "Unknown Food", // Handle case where food might be null
            quantity: item.quantity,
          })) || [], // Default to empty array if no items
      })
    );

    res.status(200).json(formattedReport);
  } catch (error: any) {
    console.error("[KASBON Summary Report API Error]", error);
    // Handle specific Prisma errors if necessary, e.g., if outletId is not found
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Outlet not found." });
    }
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}

// Helper function to apply middleware (copy from your project if different)
function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

// Apply middleware to the handler
export default applyMiddleware(handler, [corsMiddleware, withAuth]);
