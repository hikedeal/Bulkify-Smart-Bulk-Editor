import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { trackEvent } from "./services/analytics.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session, admin }) => {
      console.log("DEBUG AUTH: Scopes granted:", session.scope);
      // Sync Shop Settings (Email, Name, Timezone)
      if (admin) {
        try {
          const response = await admin.graphql(
            `#graphql
            query getShop {
              shop {
                email
                name
                ianaTimezone
              }
            }`
          );
          const responseJson = await response.json();
          const shopData = responseJson.data.shop;

          await prisma.shopSettings.upsert({
            where: { shopDomain: session.shop },
            update: {
              shopName: shopData.name,
              contactEmail: shopData.email,
              timezone: shopData.ianaTimezone,
              updatedAt: new Date()
            },
            create: {
              shopDomain: session.shop,
              shopName: shopData.name,
              contactEmail: shopData.email,
              timezone: shopData.ianaTimezone,
              updatedAt: new Date()
            }
          });

          // Track Funnel Event: install
          await trackEvent(session.shop, 'install');

          console.log("Automatically synced shop settings and tracked installation for", session.shop);
        } catch (error) {
          console.error("Failed to sync settings in afterAuth:", error);
        }
      }

      // Note: Typically registerWebhooks is called here, but referencing 'shopify' variable 
      // inside its own initializer is problematic unless handled carefully. 
      // Assuming webhooks are managed via config or registered elsewhere if needed.
      // If we need to register webhooks, we can import the instance in a separate file or use a deferred call.
      // For now, we focus on Settings Sync.

      // Since this is inside the config object, 'shopify' variable is not yet initialized.
      // To register webhooks, we might need a different approach if not handled by config.
      // However, newer templates usually use `webhooks` config object if using managed webhooks.
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
