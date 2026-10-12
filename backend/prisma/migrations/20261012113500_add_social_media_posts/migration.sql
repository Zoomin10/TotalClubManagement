-- CreateTable
CREATE TABLE "SocialMediaPost" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialMediaPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialMediaPost_url_key" ON "SocialMediaPost"("url");

-- CreateIndex
CREATE INDEX "SocialMediaPost_createdAt_idx" ON "SocialMediaPost"("createdAt");
