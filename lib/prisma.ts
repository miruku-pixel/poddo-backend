// /server/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    transactionOptions: {
      timeout: 30000, // 30 seconds - this is the transaction execution timeout
      maxWait: 8000, // 5 seconds - optional, how long to wait for a connection
      // Default is 2000ms (2 seconds). You can adjust if needed
      // for connection acquisition issues under high load.
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
