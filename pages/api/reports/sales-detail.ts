import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { PaymentType } from "@prisma/client";
import { withAuth } from "../../../middleware/authMiddleware";
import { corsMiddleware } from "../../../middleware/cors";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs"; // ✅ Import ExcelJS

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
      format,
      limit = 1000,
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
        ...(paymentType && { paymentType: paymentType as PaymentType }),
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
            diningTable: true,
            waiter: true,
            items: {
              include: {
                food: true,
                options: {
                  include: {
                    option: true,
                  },
                },
              },
            },
          },
        },
        cashier: true,
      },
      skip: Number(offset),
      take: Number(limit),
      orderBy: [{ paidAt: "asc" }, { orderNumber: "asc" }],
    });

    const rows = billings.flatMap((b) =>
      b.order.items.map((item) => {
        const options = item.options.map((opt) => ({
          optionName: opt.option.name,
          optionQuantity: opt.quantity,
          optionUnitPrice: opt.unitPrice,
          optionTotalPrice: opt.totalPrice,
        }));

        return {
          billingId: b.id,
          paidAt: b.paidAt.toISOString(),
          receiptNumber: b.receiptNumber,
          paymentType: b.paymentType,
          outletId: b.outletId,

          cashierId: b.cashierId,
          cashierName: b.cashier.username,

          orderId: b.orderId,
          orderNumber: b.order.orderNumber,
          orderType: b.order.orderType.name,
          waiterName: b.order.waiter.username,
          diningTable: b.order.diningTable?.number || "-",
          remark: b.order.remark || "-",

          subtotal: b.subtotal,
          tax: b.tax,
          discount: b.discount,
          total: b.total,
          amountPaid: b.amountPaid,
          changeGiven: b.changeGiven,

          foodId: item.foodId,
          foodName: item.food.name,
          itemQuantity: item.quantity,
          itemUnitPrice: item.unitPrice,
          itemTotalPrice: item.totalPrice,

          itemOptions: JSON.stringify(options),
        };
      })
    );

    // ✅ XLSX Export
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Sales Report");

      // Define headers
      const headers = Object.keys(rows[0] || {}).map((key) => ({
        header: key,
        key: key,
      }));
      worksheet.columns = headers;

      // Add data rows
      worksheet.addRows(rows);

      // Set response headers
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="sales-report-${Date.now()}.xlsx"`
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      // Stream XLSX to response
      await workbook.xlsx.write(res);
      return res.end();
    }

    // ✅ CSV fallback
    if (format === "csv") {
      const csv = stringify(rows, { header: true });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="sales-report-${Date.now()}.csv"`
      );
      return res.status(200).send(csv);
    }

    // ✅ Default JSON
    return res.status(200).json({ data: rows });
  } catch (error) {
    console.error("Error exporting sales report:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Middleware composition
function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);

//GET /api/reports/sales-detailed?outletId=xxx&startDate=2025-05-01&endDate=2025-05-13&format=xlsx

///api/reports/sales-detailed?outletId=xxx&startDate=2025-05-01&endDate=2025-05-12&format=csv
