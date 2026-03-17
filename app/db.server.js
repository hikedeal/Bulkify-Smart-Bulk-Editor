import { PrismaClient } from "@prisma/client";

// In development, we might need to force re-instantiation if the schema changed
if (process.env.NODE_ENV !== "production") {
  console.log(`[PRISMA] Re-initializing PrismaClient at ${new Date().toISOString()}`);
  global.prismaGlobal = new PrismaClient();
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
