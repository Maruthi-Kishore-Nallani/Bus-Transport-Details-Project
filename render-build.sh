#!/bin/bash
# Render Build Script

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Apply database migrations
npx prisma migrate deploy

# Seed the database (safe to run multiple times, uses upsert)
npm run db:seed

echo "Build completed successfully!"
