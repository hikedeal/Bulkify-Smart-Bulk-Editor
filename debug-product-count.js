
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config();

const shop = process.env.SHOP_URL || process.env.SHOPIFY_APP_URL || "hikedeal-2.myshopify.com";
const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.ADMIN_ACCESS_TOKEN;
// Note: You might need to manually set the access token if it's not in .env, or use a session token.
// Since this is a dev environment, we'll try to use what's available.

async function testProductCount() {
    console.log(`Testing product count for shop: ${shop}`);

    if (!accessToken) {
        console.error("No access token found in .env. Please set SHOPIFY_ADMIN_ACCESS_TOKEN.");
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
