import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS, PLAN_CONFIG, isProPlan } from "../utils/billing";

export { PLANS, PLAN_CONFIG, isProPlan };

export async function createSubscription(
  admin: any,
  returnUrl: string,
  planType: "PRO_MONTHLY" | "PRO_YEARLY",
  discountCode?: string,
  test: boolean = process.env.NODE_ENV !== "production"
) {
  const plan = PLAN_CONFIG[planType];
  let price = plan.price;
  let label = plan.label;

  console.log(`[Billing] Creating subscription for ${planType}. Test mode: ${test}, Return URL: ${returnUrl}`);

  // Handle discount code logic if provided
  if (discountCode) {
    const discount = await prisma.discountCode.findUnique({
      where: { code: discountCode, isActive: true }
    });

    if (discount) {
      // Check if discount applies to this plan type
      const appliesTo = discount.appliesTo;
      const isMonthly = planType === "PRO_MONTHLY";
      if (appliesTo === "BOTH" || (isMonthly && appliesTo === "MONTHLY") || (!isMonthly && appliesTo === "YEARLY")) {
        if (discount.type === "PERCENT") {
          price = price * (1 - discount.value / 100);
        } else if (discount.type === "FIXED") {
          price = Math.max(0, price - discount.value);
        }
        label = `${label} (${discountCode} applied)`;
      }
    }
  }

  const lineItems = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: price, currencyCode: "USD" },
          interval: plan.interval,
        },
      },
    },
  ];

  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: $test) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appSubscription {
          id
        }
      }
    }`,
    {
      variables: {
        name: label,
        returnUrl,
        lineItems,
        test,
      },
    }
  );

  const responseJson = await response.json();
  const result = responseJson.data?.appSubscriptionCreate;

  if (result?.userErrors && result.userErrors.length > 0) {
    console.error("[Billing] Shopify User Errors:", JSON.stringify(result.userErrors));
    throw new Error(`Shopify Billing Error: ${result.userErrors[0].message}`);
  }

  const confirmationUrl = result?.confirmationUrl;
  if (!confirmationUrl) {
    console.error("[Billing] No confirmationUrl returned. Full response:", JSON.stringify(responseJson));
    throw new Error("No confirmationUrl returned from Shopify. Check server logs.");
  }

  return confirmationUrl;
}

// Helper to check for active subscriptions
export async function checkSubscription(admin: any) {
  const response = await admin.graphql(
    `#graphql
    query AppSubscription {
      appInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
      }
    }`
  );

  const responseJson = await response.json() as any;
  const activeSubscriptions = responseJson.data?.appInstallation?.activeSubscriptions || [];

  return activeSubscriptions.filter((sub: any) => sub.status === 'ACTIVE');
}

// Get specific subscription details
export async function getSubscription(admin: any, chargeId: string) {
  const gid = chargeId.startsWith("gid://") ? chargeId : `gid://shopify/AppSubscription/${chargeId}`;

  const response = await admin.graphql(
    `#graphql
    query GetSubscription($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id
          name
          status
          test
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price {
                    amount
                  }
                  interval
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        id: gid
      }
    }
  );

  const responseJson = await response.json() as any;
  return responseJson.data?.node;
}

export async function cancelSubscription(admin: any, subscriptionId: string) {
  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        userErrors {
          field
          message
        }
        appSubscription {
          id
          status
        }
      }
    }`,
    {
      variables: {
        id: subscriptionId,
      },
    }
  );

  return response.json();
}



export async function getShopPlan(shopDomain: string) {
  const shop = await prisma.shop.findUnique({
    where: { shop: shopDomain },
    select: { plan: true, planName: true, featureFlags: true }
  });

  if (!shop) {
    return { plan: "FREE", features: PLAN_CONFIG.FREE.features };
  }

  const currentPlan = shop.planName || shop.plan || "FREE";
  let features = isProPlan(currentPlan)
    ? PLAN_CONFIG.PRO_MONTHLY.features
    : PLAN_CONFIG.FREE.features;

  return { plan: currentPlan, features, featureFlags: shop.featureFlags };
}
