// pages/api/reports/unlock-cash-reconciliation.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { withAuth } from "../../../middleware/authMiddleware"; // Your provided withAuth
import { corsMiddleware } from "../../../middleware/cors";

// Define the AuthenticatedRequest interface to extend NextApiRequest
// This is crucial for TypeScript to understand that `req.user` exists
interface AuthenticatedRequest extends NextApiRequest {
  user?: {
    id: string;
    role: string; // Ensure this matches the `user.role` from your JWT payload / Prisma user model
  };
}

async function handler(req: AuthenticatedRequest, res: NextApiResponse) {
  // Ensure only POST requests
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use POST" });
  }

  // --- Crucial Role Check ---
  // Ensure user is authenticated and has ADMIN role
  // 'req.user' is populated by your 'withAuth' middleware
  // 'req.user.role' contains the role string
  if (!req.user || req.user.role !== "ADMIN") {
    // <--- THIS IS THE IMPORTANT LINE
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admin can unlock this report." });
  }

  try {
    const { outletId, date } = req.body;

    // Input Validation
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

    // Find and update the reconciliation record
    const updatedRecord = await prisma.dailyCashReconciliation.update({
      where: {
        outletId_date: {
          outletId: outletId as string,
          date: startOfDay,
        },
      },
      data: {
        isLocked: false, // Set to unlocked
      },
    });

    if (!updatedRecord) {
      return res.status(404).json({
        error:
          "Reconciliation record not found for the specified date and outlet.",
      });
    }

    res.status(200).json({
      message: "Daily cash reconciliation unlocked successfully.",
      data: updatedRecord,
    });
  } catch (error) {
    console.error("Error unlocking daily cash reconciliation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
