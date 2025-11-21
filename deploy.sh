#!/bin/bash

echo "🚀 Bus Transport - Production Deployment Script"
echo "================================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file not found!"
    echo "Copy .env.example to .env and configure it first."
    exit 1
fi

# Check required environment variables
echo "✅ Checking environment variables..."
node -e "
const required = ['NODE_ENV', 'ADMIN_JWT_SECRET', 'DATABASE_URL', 'GOOGLE_MAPS_API_KEY', 'CORS_ORIGIN'];
const missing = [];
required.forEach(key => {
    if (!process.env[key]) missing.push(key);
});
if (missing.length > 0) {
    console.error('❌ Missing required variables:', missing.join(', '));
    process.exit(1);
}
if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  WARNING: NODE_ENV is not set to production');
}
console.log('✅ All required variables set');
"

if [ $? -ne 0 ]; then
    exit 1
fi

# Install dependencies
echo ""
echo "📦 Installing production dependencies..."
npm ci --only=production

# Generate Prisma client
echo ""
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run database migrations
echo ""
echo "🗄️  Running database migrations..."
npx prisma migrate deploy

# Test database connection
echo ""
echo "🔌 Testing database connection..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$connect()
    .then(() => {
        console.log('✅ Database connection successful');
        return prisma.\$disconnect();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    });
"

if [ $? -ne 0 ]; then
    exit 1
fi

echo ""
echo "✅ Deployment preparation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Start server: npm start"
echo "2. Or use PM2: pm2 start server.js --name bus-transport"
echo "3. Test endpoints: curl http://localhost:3000/api/health"
echo ""
echo "⚠️  IMPORTANT REMINDERS:"
echo "- Ensure HTTPS is configured"
echo "- Verify CORS_ORIGIN is set to your domain"
echo "- Check that SECURE_COOKIES=true if using HTTPS"
echo "- Monitor logs after deployment"
