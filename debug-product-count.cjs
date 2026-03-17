
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Try to load .env manually since dotenv might not be working as expected or we need to handle it better
try {
    const envPath = path.resolve(__dirname, '.env');
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.log("Could not load .env file");
}

const shop = process.env.SHOP || "hikedeal-2.myshopify.com";
// We need a real access token. If not in .env, we can't run this standalone easily.
// Let's print what we have.
const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_API_SECRET;

async function testProductCount() {
    console.log(`Testing product count for shop: ${shop}`);
    console.log(`Using token starting with: ${accessToken ? accessToken.substring(0, 5) + '...' : 'NONE'}`);

    if (!accessToken) {
        console.error("No access token found. Please set SHOPIFY_ADMIN_ACCESS_TOKEN in .env or hardcode it for testing.");
        return;
    }

    const query = `
    {
        productsCount {
            count
        }
    }`;

    try {
        const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken
            },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        console.log("Response:", JSON.stringify(data, null, 2));

    } catch (error) {
        console.error("Error:", error);
    }
}

testProductCount();
