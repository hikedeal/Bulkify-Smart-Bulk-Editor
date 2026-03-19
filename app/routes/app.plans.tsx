import { useState, useCallback, useEffect } from "react";
import {
    Page,
    Layout,
    BlockStack,
    Text,
    Button,
    Grid,
    Box,
    Divider,
    List,
    InlineStack,
    Badge,
    ButtonGroup,
    TextField,
    Banner,
    Icon,
    Modal,
} from "@shopify/polaris";
import { CheckIcon, LockIcon } from "@shopify/polaris-icons";
import { useLoaderData, useFetcher, useSubmit, redirect, useNavigate, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { trackEvent } from "../services/analytics.server";
import { createSubscription, checkSubscription, cancelSubscription, getSubscription } from "../services/billing.server";
import { isProPlan } from "../utils/billing";
import { boundary } from "@shopify/shopify-app-react-router/server";
import "../styles/pricing.css";

// --- Loader & Action ---
export const loader = async ({ request }: any) => {
    try {
        const url = new URL(request.url);
        console.log(`[DEBUG] Plans Loader Start: ${url.pathname}${url.search}`);
        const { session, admin, redirect: shopifyRedirect } = await authenticate.admin(request);
        const shop = session.shop;
        const status = url.searchParams.get("status");

        // Track Funnel Event: plans_opened
        await trackEvent(shop, 'plans_opened');

        // 1. Sync subscription status if coming back from Shopify success
        if (status === "success") {
            const charge_id = url.searchParams.get("charge_id");
            console.log(`[DEBUG] Plans: Success callback. Shop: ${shop}, Charge ID: ${charge_id}`);

            try {
                let sub = null;

                // OPTION A: If we have a charge_id, query it directly (More robust)
                if (charge_id) {
                    // Simple retry loop for replication lag
                    for (let i = 0; i < 3; i++) {
                        console.log(`[DEBUG] Attempt ${i + 1}: Fetching subscription for charge ${charge_id}`);
                        const foundSub = await getSubscription(admin, charge_id);
                        console.log(`[DEBUG] Found sub:`, JSON.stringify(foundSub, null, 2));

                        if (foundSub?.status === 'ACTIVE') {
                            sub = foundSub;
                            break;
                        }
                        console.log(`[DEBUG] Plans: Charge ${charge_id} not active yet (Status: ${foundSub?.status}), retrying... (${i + 1}/3)`);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Increased wait to 2s
                    }
                }

                // OPTION B: Fallback to checking all active subscriptions
                if (!sub) {
                    console.log("[DEBUG] Fallback: Checking all active subscriptions");
                    const activeSubscriptions = await checkSubscription(admin);
                    console.log(`[DEBUG] Active subscriptions found: ${activeSubscriptions?.length}`);
                    if (activeSubscriptions && activeSubscriptions.length > 0) {
                        sub = activeSubscriptions[0]; // Take the first active one
                        console.log(`[DEBUG] Using first active sub: ${sub.id} - ${sub.name}`);
                    }
                }

                if (sub && sub.status === 'ACTIVE') {
                    const standardizedName = sub.name; // Keep original first
                    const isPro = isProPlan(standardizedName);
                    console.log(`[DEBUG] Plans: Verified subscription: "${standardizedName}", isPro check result: ${isPro}`);

                    if (isPro) {
                        const isYearly = standardizedName.toUpperCase().includes("YEARLY") || standardizedName.toUpperCase().includes("ANNUAL");

                        // Fetch shop details for directory
                        const shopResponse = await admin.graphql(
                            `#graphql
                        query {
                            shop {
                                name
                                email
                            }
                        }`
                        );
                        const shopJson = await shopResponse.json();
                        const shopDetails = shopJson.data?.shop;

                        // Safe logic for price extraction
                        const pricingDetails = sub.lineItems?.[0]?.plan?.pricingDetails;
                        const billing_price = parseFloat(pricingDetails?.price?.amount || "0");
                        const billing_interval = pricingDetails?.interval || (isYearly ? "ANNUAL" : "EVERY_30_DAYS");

                        const standardizedInterval = (billing_interval === "ANNUAL" || isYearly) ? "YEARLY" : "MONTHLY";
                        const standardizedPlanName = isYearly ? "PRO_YEARLY" : "PRO_MONTHLY";

                        console.log(`[DEBUG] Updating DB: Plan=${standardizedPlanName}, Interval=${standardizedInterval}, Price=${billing_price}, ShopName=${shopDetails?.name}`);

                        const updateResult = await prisma.shop.upsert({
                            where: { shop },
                            update: {
                                plan: standardizedPlanName,
                                planName: standardizedPlanName,
                                shopName: shopDetails?.name,
                                email: shopDetails?.email,
                                billingStatus: "ACTIVE",
                                billingInterval: standardizedInterval,
                                planPrice: billing_price,
                                billingPrice: billing_price,
                                subscriptionId: sub.id,
                                billingChargeId: charge_id || sub.id,
                                updatedAt: new Date()
                            },
                            create: {
                                shop: shop,
                                shopName: shopDetails?.name,
                                email: shopDetails?.email,
                                plan: standardizedPlanName,
                                planName: standardizedPlanName,
                                billingStatus: "ACTIVE",
                                billingInterval: standardizedInterval,
                                planPrice: billing_price,
                                billingPrice: billing_price,
                                subscriptionId: sub.id,
                                billingChargeId: charge_id || sub.id,
                                updatedAt: new Date(),
                                createdAt: new Date()
                            }
                        });
                        // Handle Discount Redemption if pending
                        if (updateResult.discountCode) {
                            const discount = await prisma.discountCode.findUnique({
                                where: { code: updateResult.discountCode }
                            });

                            if (discount) {
                                // Record redemption
                                await prisma.discountRedemption.create({
                                    data: {
                                        discountCodeId: discount.id,
                                        shopId: shop,
                                        planInterval: standardizedInterval,
                                        originalPriceCents: Math.round(billing_price * 100 / (1 - Number(updateResult.discountAmount || 0) / (billing_price + Number(updateResult.discountAmount || 0)))), // Approximate
                                        discountedPriceCents: Math.round(billing_price * 100),
                                        redeemedAt: new Date()
                                    }
                                });

                                // Increment usage
                                await prisma.discountCode.update({
                                    where: { id: discount.id },
                                    data: { usedCount: { increment: 1 } }
                                });

                                // Clear pending discount from shop
                                await prisma.shop.update({
                                    where: { shop },
                                    data: { discountCode: null, discountAmount: null }
                                });
                            }
                        }

                        console.log("[DEBUG] DB Update Success:", updateResult);

                        // Track Funnel Event: billing_success
                        await trackEvent(shop, 'billing_success');

                        console.log("[DEBUG] Plans: Successfully updated Prisma to PRO. Redirecting to /app");
                        return shopifyRedirect("/app");
                    } else {
                        console.warn(`[DEBUG] Plan name "${standardizedName}" failed isProPlan check.`);
                    }
                } else {
                    console.warn("[DEBUG] Plans: Success status received but no active PRO subscription found in Shopify.");
                }
            } catch (e) {
                if (e instanceof Response && e.status === 302) throw e;
                console.error("[DEBUG] Plans: Subscription sync failed:", e);
            }
        }

        const shopData = await prisma.shop.findUnique({
            where: { shop },
            select: {
                plan: true,
                planName: true,
                billingStatus: true,
                billingInterval: true,
                planPrice: true,
                discountCode: true,
                discountAmount: true
            }
        });

        const currentPlan = shopData?.planName || shopData?.plan || null;
        const billingStatus = shopData?.billingStatus || "INACTIVE";
        const currentInterval = shopData?.billingInterval || "MONTHLY";
        const discountAmount = shopData?.discountAmount ? Number(shopData.discountAmount) : 0;
        const host = url.searchParams.get("host");
        const result = { currentPlan, billingStatus, currentInterval, shop, host, discountAmount };
        console.log("[DEBUG] Plans Loader Success. Host:", host);
        return result;
    } catch (e) {
        console.error("[ERROR] Plans Loader Failed:", e);
        throw e;
    }
};
export const action = async ({ request }: any) => {
    console.log("Plans Action: Hit! Method:", request.method);
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");
    console.log(`Plans Action Processed: intent=${intent}, shop=${shop}`);

    if (intent === "validate-discount") {
        const code = formData.get("code") as string;
        const discount = await prisma.discountCode.findUnique({
            where: { code }
        });

        if (!discount || !discount.isActive) return { ok: false, error: "Invalid discount code" };
        if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) return { ok: false, error: "Expired" };
        if (discount.maxUses && discount.usedCount >= discount.maxUses) return { ok: false, error: "Limit reached" };

        return {
            ok: true,
            discount: {
                ...discount,
                value: Number(discount.value)
            }
        };
    }

    if (intent === "select-free" || intent === "proceed") {
        console.log(`Plans action: intent=${intent}, shop=${shop}`);
        try {
            await prisma.shop.upsert({
                where: { shop },
                update: {
                    plan: "FREE",
                    planName: "FREE",
                    billingStatus: "FREE",
                    billingInterval: "FREE",
                    planPrice: 0,
                    billingPrice: 0,
                    updatedAt: new Date()
                },
                create: {
                    shop,
                    plan: "FREE",
                    planName: "FREE",
                    billingStatus: "FREE",
                    billingInterval: "FREE",
                    planPrice: 0,
                    billingPrice: 0,
                    updatedAt: new Date(),
                    createdAt: new Date()
                }
            });

            console.log("Prisma updated successfully");
            return { ok: true, success: true };
        } catch (err: any) {
            console.error("Action error:", err);
            return { ok: false, error: err.message || "An unexpected error occurred" };
        }

    }

    if (intent === "proceed-pro") {
        return redirect("/app");
    }

    if (intent === "subscribe") {
        const planType = formData.get("planType") as string;
        const discountCode = formData.get("discountCode") as string;
        const host = formData.get("host");

        // Save pending discount info to shops table
        if (discountCode) {
            const discount = await prisma.discountCode.findUnique({
                where: { code: discountCode }
            });

            if (discount) {
                const basePrice = planType === "PRO_MONTHLY" ? 15 : 150;
                let finalPrice = basePrice;
                if (discount.type === "PERCENT") finalPrice = basePrice * (1 - Number(discount.value) / 100);
                else if (discount.type === "FIXED") finalPrice = Math.max(0, basePrice - Number(discount.value));

                await prisma.shop.update({
                    where: { shop },
                    data: {
                        discountCode: discount.code,
                        discountAmount: basePrice - finalPrice
                    }
                });
            }
        }

        const appUrl = process.env.SHOPIFY_APP_URL;
        // Shopify requires the returnUrl to be a sub-path of the app's URL.
        const returnUrl = `${appUrl}/app/plans?status=success`;
        
        console.log(`[Plans] Attempting subscription. Shop: ${shop}, Plan: ${planType}, Return URL: ${returnUrl}`);

        try {
            const confirmationUrl = await createSubscription(admin, returnUrl, planType as any, discountCode as any);

            await trackEvent(shop, 'upgrade_clicked', { plan_type: planType });

            return { confirmationUrl };
        } catch (err: any) {
            console.error("[Plans] Subscription error:", err);
            return { ok: false, error: err.message || "Subscription failed" };
        }
    }

    if (intent === "downgrade") {
        const shopData = await prisma.shop.findUnique({
            where: { shop },
            select: { billingChargeId: true, subscriptionId: true }
        });

        const subscriptionId = shopData?.subscriptionId || shopData?.billingChargeId;

        if (subscriptionId) {
            try {
                // Ensure GID format
                const finalId = subscriptionId.toString().startsWith("gid://")
                    ? subscriptionId
                    : `gid://shopify/AppSubscription/${subscriptionId}`;

                console.log(`Downgrade: Attempting to cancel subscription ${finalId} (Original: ${subscriptionId})`);
                const cancelResponse = await cancelSubscription(admin, finalId);
                const userErrors = cancelResponse?.data?.appSubscriptionCancel?.userErrors || [];

                if (userErrors.length > 0) {
                    console.error("Downgrade: Failed to cancel subscription:", userErrors);
                } else {
                    console.log("Downgrade: Subscription cancelled successfully.");
                }
            } catch (e) {
                console.error("Downgrade: Error calling Shopify cancel:", e);
            }
        }

        await prisma.shop.update({
            where: { shop },
            data: {
                plan: "FREE",
                planName: "FREE",
                billingStatus: "FREE",
                billingInterval: "FREE",
                planPrice: 0,
                billingPrice: 0,
                subscriptionId: null,
                billingChargeId: null,
                updatedAt: new Date()
            }
        });

        // Track Funnel Event: downgrade
        await trackEvent(shop, 'downgraded_to_free');

        return redirect("/app");
    }
    return null;
};

export default function PlansPage() {
    const { currentPlan, billingStatus, currentInterval, host, discountAmount } = useLoaderData();
    const actionData = useActionData();
    const fetcher = useFetcher();
    const submit = useSubmit();
    const navigate = useNavigate();

    const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
    const [discountCode, setDiscountCode] = useState("");
    const [appliedDiscount, setAppliedDiscount] = useState<any>(null);
    const [discountError, setDiscountError] = useState("");
    const [isDowngradeModalOpen, setIsDowngradeModalOpen] = useState(false);

    const isPro = isProPlan(currentPlan) || billingStatus === "ACTIVE";
    const isFree = !isPro && currentPlan === "FREE";

    // Handle cross-domain billing redirect to escape iframe
    useEffect(() => {
        if (actionData && 'confirmationUrl' in actionData && actionData.confirmationUrl && window.top) {
            window.top.location.href = actionData.confirmationUrl as string;
        }

        if (actionData?.ok && !actionData?.confirmationUrl) {
            window.shopify.toast.show("Plan updated successfully");
        }

        if (actionData?.error) {
            window.shopify.toast.show(actionData.error as string, { isError: true });
        }
    }, [actionData]);

    // Monitor fetcher for downgrade/activation/free-select success
    useEffect(() => {
        // Cast to any to avoid TS errors
        const f = fetcher as any;
        if (f.state === "idle" && f.data && f.formMethod === "post") {
            const intent = f.data.intent || f.formData?.get("intent");
            if (intent === "downgrade" || intent === "select-free") {
                console.log(`${intent} fetcher completed:`, f.data);
                if (f.data.ok || f.data.success) {
                    window.shopify.toast.show("Plan updated");
                    navigate("/app");
                }
            }
        }
    }, [fetcher.state, fetcher.data, navigate]);

    const handleApplyDiscount = () => {
        if (!discountCode) return;
        setDiscountError("");
        fetcher.submit({ intent: "validate-discount", code: discountCode }, { method: "post" });
    };

    useEffect(() => {
        if (fetcher.data && fetcher.state === "idle") {
            if (fetcher.data.ok) {
                setAppliedDiscount(fetcher.data.discount);
                setDiscountError("");
            } else {
                setAppliedDiscount(null);
                setDiscountError(fetcher.data.error);
            }
        }
    }, [fetcher.data, fetcher.state]);

    // Pricing Logic
    const basePrice = interval === "MONTHLY" ? 15 : 150;
    const calculatePrice = (price: number) => {
        if (!appliedDiscount) return price;
        const appliesTo = appliedDiscount.appliesTo || appliedDiscount.applies_to;
        if (appliesTo !== "BOTH" && appliesTo !== interval) return price;
        if (appliedDiscount.type === "PERCENT") return price * (1 - Number(appliedDiscount.value) / 100);
        return Math.max(0, price - Number(appliedDiscount.value) / 100); // Fixed value is in cents? User said "fixed cents"
    };
    const finalPrice = calculatePrice(basePrice);
    const isDiscounted = finalPrice < basePrice;

    const handleSubscribe = () => {
        const formData = new FormData();
        formData.append("intent", "subscribe");
        formData.append("planType", interval === "MONTHLY" ? "PRO_MONTHLY" : "PRO_YEARLY");
        if (appliedDiscount) formData.append("discountCode", appliedDiscount.code);
        if (host) formData.append("host", host);
        submit(formData, { method: "post" });
    };

    const handleDowngrade = () => {
        console.log("Downgrade button clicked - using fetcher");
        const formData = new FormData();
        formData.append("intent", "downgrade");
        fetcher.submit(formData, { method: "post", action: "/app/plans" });
        setIsDowngradeModalOpen(false);
    };

    const freeFeatures = ["Price Updates", "Compare At Price", "Cost Tracking", "Status Management"];
    const proFeatures = [
        "Everything in Free",
        "Unlimited Inventory Sync",
        "Advanced Tag Management",
        "Metafield Editing",
        "Bulk Vendor Edits",
        "Product Type Updates",
        "Scheduled Tasks",
        "Auto-Revert Changes",
        "Priority Support"
    ];

    return (
        <Page fullWidth>
            <Layout>
                <Layout.Section>
                    <div className="premium-hero">
                        <div className="hero-background-shapes">
                            <div className="hero-shape hero-shape-1" />
                            <div className="hero-shape hero-shape-2" />
                        </div>
                        <h1 style={{ position: 'relative', zIndex: 1 }}>Choose your plan</h1>
                        <p style={{ position: 'relative', zIndex: 1 }}>Unlock advanced bulk editing features and scale your store faster with Bulkify Pro.</p>

                        <div className="pricing-toggle-container" style={{ position: 'relative', zIndex: 1 }}>
                            <button
                                type="button"
                                className={`pricing-toggle-btn ${interval === "MONTHLY" ? "active" : ""}`}
                                onClick={() => setInterval("MONTHLY")}
                            >
                                Monthly
                            </button>
                            <button
                                type="button"
                                className={`pricing-toggle-btn ${interval === "YEARLY" ? "active" : ""}`}
                                onClick={() => setInterval("YEARLY")}
                            >
                                Yearly
                                <span className="save-badge">Save 20%</span>
                            </button>
                        </div>
                    </div>
                </Layout.Section>

                <Layout.Section>
                    <div className="pricing-cards-wrapper">
                        {/* Free Card */}
                        <div className="pricing-card">
                            <div className="plan-name">Free</div>
                            <div className="plan-price">
                                <span className="price-amount">$0</span>
                                <span className="price-period">/ forever</span>
                            </div>
                            <p className="plan-desc">Essential tools for small shops getting started.</p>

                            <div className="features-list">
                                {freeFeatures.map(f => (
                                    <div className="feature-item" key={f}>
                                        <div className="feature-icon check">
                                            <Icon source={CheckIcon} />
                                        </div>
                                        <span>{f}</span>
                                    </div>
                                ))}
                            </div>

                            <button
                                type="button"
                                className="plan-btn secondary"
                                disabled={isFree || fetcher.state === 'submitting'}
                                onClick={() => {
                                    if (isFree) {
                                        // Already on free plan
                                    } else if (!isPro && currentPlan !== "FREE") {
                                        // New user or undefined plan -> Initialize as Free
                                        const formData = new FormData();
                                        formData.append("intent", "select-free");
                                        fetcher.submit(formData, { method: "post" });
                                    } else {
                                        // Paid user downgrading
                                        setIsDowngradeModalOpen(true);
                                    }
                                }}
                            >
                                {fetcher.state === 'submitting' ? "Processing..." : (isFree ? "Current plan" : (!isPro && currentPlan !== "FREE" ? "Continue with Free" : "Downgrade to Free"))}
                            </button>
                        </div>

                        {/* Pro Card */}
                        <div className="pricing-card pro">
                            <div className="most-popular-badge">Most Popular</div>
                            <div className="plan-name">Pro</div>
                            <div className="plan-price">
                                <span className="price-amount">${finalPrice.toFixed(0)}</span>
                                <span className="price-period">/ {interval === "MONTHLY" ? "month" : "year"}</span>
                                {isDiscounted && <span className="price-original">${basePrice}</span>}
                            </div>
                            <p className="plan-desc">Unlock full power automation and scheduling.</p>

                            <div className="features-list">
                                {proFeatures.map(f => (
                                    <div className="feature-item" key={f}>
                                        <div className="feature-icon check-pro">
                                            <Icon source={CheckIcon} />
                                        </div>
                                        <span>{f}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Discount Input */}
                            <div className="discount-box">
                                {appliedDiscount ? (
                                    <div style={{ color: '#10b981', fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px' }}>
                                        Discount code <b>{appliedDiscount.code}</b> applied!
                                    </div>
                                ) : (
                                    <div className="discount-input-group">
                                        <input
                                            type="text"
                                            className="discount-input"
                                            placeholder="Discount code"
                                            value={discountCode}
                                            onChange={(e) => setDiscountCode(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="discount-apply-btn"
                                            onClick={handleApplyDiscount}
                                            disabled={fetcher.state === "submitting"}
                                        >
                                            {fetcher.state === "submitting" ? "..." : "Apply"}
                                        </button>
                                    </div>
                                )}
                                {discountError && (
                                    <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '4px' }}>
                                        {discountError}
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                className="plan-btn primary"
                                disabled={isPro}
                                onClick={handleSubscribe}
                            >
                                {isPro ? "Current plan" : `Upgrade to Pro ${interval === "MONTHLY" ? "Monthly" : "Yearly"}`}
                            </button>
                        </div>
                    </div>
                </Layout.Section>

                <Layout.Section>
                    <Box paddingBlockEnd="1600">
                        <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                                <BlockStack inlineAlign="center" gap="200">
                                    <Text variant="headingSm" as="h3">Secure Shopify Billing</Text>
                                    <Text as="p" tone="subdued" alignment="center">Payments handled directly by Shopify.</Text>
                                </BlockStack>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                                <BlockStack inlineAlign="center" gap="200">
                                    <Text variant="headingSm" as="h3">Cancel anytime</Text>
                                    <Text as="p" tone="subdued" alignment="center">No long-term contracts.</Text>
                                </BlockStack>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                                <BlockStack inlineAlign="center" gap="200">
                                    <Text variant="headingSm" as="h3">Priority Support</Text>
                                    <Text as="p" tone="subdued" alignment="center">Fast help when you need it.</Text>
                                </BlockStack>
                            </Grid.Cell>
                        </Grid>
                    </Box>
                </Layout.Section>
            </Layout>

            <Modal
                open={isDowngradeModalOpen}
                onClose={() => setIsDowngradeModalOpen(false)}
                title="Confirm Downgrade"
                primaryAction={{
                    content: "Downgrade to Free",
                    onAction: handleDowngrade,
                    destructive: true,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => setIsDowngradeModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <Text as="p">
                            Are you sure you want to downgrade to the Free plan?
                        </Text>
                        <Text as="p" tone="subdued">
                            By downgrading, you will lose access to Pro features like:
                        </Text>
                        <List>
                            <List.Item>Unlimited inventory sync</List.Item>
                            <List.Item>Scheduled & auto-revert tasks</List.Item>
                            <List.Item>Metafield and Tag management</List.Item>
                        </List>
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </Page>
    );
}

export const headers = (headersArgs: any) => {
    return boundary.headers(headersArgs);
};
