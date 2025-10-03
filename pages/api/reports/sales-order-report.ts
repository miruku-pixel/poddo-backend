import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, PaymentStatus } from "@prisma/client";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";

const prisma = new PrismaClient();

interface BillingReportEntry {
  receiptNumber: string;
  orderNumber: string;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  changeGiven: number;
  status: PaymentStatus;
  paymentType: string;
  cashier: string;
  paidAt: string;
}

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

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res
        .status(400)
        .json({ error: "Invalid date format provided. Use YYYY-MM-DD." });
    }

    // Fetch all billing records (excluding VOID) within the specified date range and outlet
    const billings = await prisma.billing.findMany({
      where: {
        outletId: outletId,
        paidAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        receiptNumber: true,
        orderNumber: true,
        subtotal: true,
        discount: true,
        total: true,
        amountPaid: true,
        changeGiven: true,
        status: true,
        paymentType: true,
        paidAt: true,
        cashier: {
          select: {
            username: true, // Assuming your User model has a username field
          },
        },
      },
      orderBy: {
        paidAt: "asc", // Order by transaction time
      },
    });

    // Format the response data to match the client expectation
    const formattedReport: BillingReportEntry[] = billings.map(
      (billing: any) => ({
        receiptNumber: billing.receiptNumber,
        orderNumber: billing.orderNumber,
        subtotal: billing.subtotal,
        discount: billing.discount,
        total: billing.total,
        amountPaid: billing.amountPaid,
        changeGiven: billing.changeGiven,
        status: billing.status,
        paymentType: billing.paymentType,
        cashier: billing.cashier.username, // Extract cashier username
        paidAt: billing.paidAt.toISOString(),
      })
    );

    res.status(200).json(formattedReport);
  } catch (error: any) {
    console.error("[Sales Order Report API Error]", error);

    // Handle specific Prisma errors (e.g., P2025 for not found, if applied)
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ error: "Outlet or related record not found." });
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
