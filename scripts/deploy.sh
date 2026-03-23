#!/bin/bash

# Bulkify VPS Deployment Script
# Targets: Ubuntu 22.04+ (Hostinger VPS)

set -e

echo "🚀 Starting Bulkify Deployment..."

# 1. Environment Check
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

# 2. Repo Update
echo "📁 Updating Codebase..."
if [ -d ".git" ]; then
    git pull origin main
else
    echo "⚠️ Not a git repository. Please clone the repo first or skip this step."
fi

# 3. Dependencies & Build
echo "⚙️ Installing Dependencies..."
npm install

echo "🛠️ Generating Prisma Client..."
npx prisma generate

echo "🏗️ Building Application..."
npm run build

# 4. Start/Restart Application
echo "🔄 Starting Application with PM2..."
if pm2 show bulkify &> /dev/null; then
    pm2 restart bulkify
else
    pm2 start ecosystem.config.cjs
fi

pm2 save

echo "✅ Deployment Complete! Bulkify is running on port 3001."
echo "🔍 Run 'pm2 logs bulkify' to see logs."
