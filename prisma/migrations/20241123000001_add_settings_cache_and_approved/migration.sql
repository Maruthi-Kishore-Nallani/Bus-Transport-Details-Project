-- AlterTable Admin - Add approved field
ALTER TABLE "Admin" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable SiteSettings
CREATE TABLE "SiteSettings" (
    "id" SERIAL NOT NULL,
    "siteTitle" TEXT NOT NULL DEFAULT 'BUS TRANSPORT DETAILS',
    "organizationName" TEXT NOT NULL DEFAULT '',
    "contactAddress" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable RouteCache
CREATE TABLE "RouteCache" (
    "id" SERIAL NOT NULL,
    "busId" INTEGER NOT NULL,
    "period" "Period" NOT NULL,
    "routeData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteCache_updatedAt_idx" ON "RouteCache"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RouteCache_busId_period_key" ON "RouteCache"("busId", "period");

-- AddForeignKey
ALTER TABLE "RouteCache" ADD CONSTRAINT "RouteCache_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update existing Stop table to add CASCADE delete
ALTER TABLE "Stop" DROP CONSTRAINT IF EXISTS "Stop_busId_fkey";
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
