import { redirect, useLoaderData, useFetcher, useNavigate } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Badge,
    IndexTable,
    Button,
    InlineStack,
    Box,
    Select,
    TextField,
    Grid,
    Divider,
    Banner,
    Icon,
    Checkbox,
    Modal,
    Toast,
    Frame,
} from "@shopify/polaris";
import {
    ChevronLeftIcon,
    ExternalIcon,
    CheckCircleIcon,
    AlertCircleIcon,
    RefreshIcon,
    ProductIcon,
    MagicIcon,
    SettingsIcon,
    NoteIcon,
    WrenchIcon,
    ListBulletedIcon,
    DeleteIcon,
    AlertBubbleIcon,
    ExportIcon,
    CashDollarIcon
} from "@shopify/polaris-icons";
import { useState, useCallback, useEffect } from "react";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { cancelBulkOperation } from "../services/bulk-operation.server";

import { ADMIN_ALLOWLIST } from "../constants";

export const loader = async ({ request, params }) => {
    const { session: adminSession } = await authenticate.admin(request);
    if (!ADMIN_ALLOWLIST.includes(adminSession.shop)) {
        return redirect("/app");
    }

    const { shopDomain: shop_domain } = params;
    console.log(`[DEBUG] Support Admin Loader for: ${shop_domain}`);

    // 1. Fetch Local Shop Details
    const dbShop = await prisma.shop.findUnique({ where: { shop: shop_domain } });
    if (!dbShop) return redirect("/app/support-admin");

    // Requirement #1 & #3: Detect installation status from Session table
    const activeSession = await prisma.session.findFirst({
        where: {
            shop: shop_domain,
            isOnline: false
        }
    });

    const isInstalled = !!activeSession || !dbShop.uninstalledAt;

    // 2. Fetch Live Shopify Data (Cached for 12 hours)
    let shopifyDetails = dbShop.shopifyData;
    let shopifyFetchError = null;
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const needsSync = !shopifyDetails || !dbShop.lastShopifySync ||
        (new Date().getTime() - new Date(dbShop.lastShopifySync).getTime() > TWELVE_HOURS);

    if (needsSync) {
        try {
            const { admin } = await unauthenticated.admin(shop_domain);
            if (!admin) {
                if (!shopifyDetails) shopifyFetchError = "No offline session found for this shop.";
            } else {
                const response = await admin.graphql(`
                    query {
                        shop {
                            name
                            email
                            contactEmail
                            billingAddress {
                                country
                            }
                            currencyCode
                            plan {
                                displayName
                                shopifyPlus
                            }
                            ianaTimezone
                        }
                    }
                `);
                const json = await response.json();
                if (json.errors) {
                    if (!shopifyDetails) shopifyFetchError = "GraphQL Errors: " + json.errors.map(e => e.message).join(", ");
                } else {
                    shopifyDetails = json.data?.shop;
                    // Background update DB with cached data
                    await prisma.shop.update({
                        where: { shop: shop_domain },
                        data: {
                            shopifyData: shopifyDetails,
                            lastShopifySync: new Date()
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Shopify API fetch failed for", shop_domain, ":", e);
            if (!shopifyDetails) shopifyFetchError = e.message || "Failed to connect to Shopify API.";
        }
    }

    // 3. Task Analytics & Logs (Unified Promise.all)
    let jobs = [];
    let supportNotes = [];
    let adminLogs = [];
    let discountCodes = [];
    let latestRedemption = null;

    let discountFetchError = null;
    try {
        const results = await Promise.all([
            prisma.priceJob.findMany({
                where: { shopDomain: shop_domain },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.supportNote.findMany({
                where: { shopDomain: shop_domain },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.adminActionLog.findMany({
                where: { shopDomain: shop_domain },
                orderBy: { createdAt: 'desc' },
                take: 10
            }),
            prisma.discountCode.findMany({
                where: { createdByShop: shop_domain },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.discountRedemption.findFirst({
                where: { shopId: shop_domain },
                orderBy: { redeemedAt: 'desc' },
                include: { discountCode: true }
            })
        ]);

        [jobs, supportNotes, adminLogs, discountCodes, latestRedemption] = results;
        discountCodes = discountCodes.map(d => ({ ...d, value: Number(d.value) }));

    } catch (e) {
        console.error("Failed to fetch support data in parallel:", e);
        discountFetchError = e.message || "Failed to fetch related store data.";
    }
    const analytics = {
        totalTasks: jobs.length,
        completedTasks: jobs.filter(j => (j.status === 'completed' || j.status === 'archived') && j.revertStatus !== 'reverted').length,
        failedTasks: jobs.filter(j => j.status === 'failed').length,
        revertedTasks: jobs.filter(j => j.status === 'reverted' || j.revertStatus === 'reverted').length,
        lastTaskDate: jobs.length ? jobs[0].createdAt : null
    };
    return {
        shop: {
            ...dbShop,
            isInstalled,
            installedAt: dbShop.createdAt,
            uninstalledAt: dbShop.uninstalledAt,
            lastSeenAt: dbShop.updatedAt,
            planPrice: Number(dbShop.planPrice || 0),
            billingPrice: Number(dbShop.billingPrice || 0),
            activeDiscountCode: latestRedemption?.discountCode?.code || dbShop.discountCode,
            activeDiscountAmount: latestRedemption ? (latestRedemption.originalPriceCents - latestRedemption.discountedPriceCents) / 100 : Number(dbShop.discountAmount || 0)
        },
        shopifyDetails,
        shopifyFetchError,
        analytics,
        recentTasks: jobs.slice(0, 10),
        supportNotes,
        adminLogs,
        discountCodes,
        discountFetchError
    };
};

export const action = async ({ request, params }) => {
    const { session: adminSession } = await authenticate.admin(request);
    if (!ADMIN_ALLOWLIST.includes(adminSession.shop)) return new Response(null, { status: 403 });

    const { shopDomain: shop_domain } = params;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "update-flags") {
        const flagsJson = formData.get("flags");
        try {
            const flags = JSON.parse(flagsJson);
            await prisma.shop.update({
                where: { shop: shop_domain },
                data: { featureFlags: flags }
            });

            await prisma.adminActionLog.create({
                data: {
                    shopDomain: shop_domain,
                    actionType: "update_feature_flags",
                    actionPayload: flags
                }
            });
            return { ok: true, message: "Feature flags updated" };
        } catch (e) {
            return { ok: false, error: "Invalid flags configuration" };
        }
    }

    if (intent === "save-note") {
        const issueText = formData.get("issueText");
        const priority = formData.get("priority");
        const followUpDate = formData.get("followUpDate");

        await prisma.supportNote.create({
            data: {
                shopDomain: shop_domain,
                issueText,
                priority,
                followUpDate: followUpDate ? new Date(followUpDate) : null
            }
        });
        return { ok: true, message: "Support note saved" };
    }

    if (intent === "support-action") {
        const actionType = formData.get("actionType");

        if (actionType === "retry-failed") {
            const failedJobs = await prisma.priceJob.findMany({
                where: { shopDomain: shop_domain, status: "failed" }
            });
            for (const job of failedJobs) {
                await prisma.priceJob.update({
                    where: { jobId: job.jobId },
                    data: { status: "pending", updatedAt: new Date() }
                });
            }
            return { ok: true, message: `Queued ${failedJobs.length} tasks for retry` };
        }

        if (actionType === "rerun-task") {
            const jobId = formData.get("jobId");
            await prisma.priceJob.update({
                where: { jobId },
                data: { status: "pending", updatedAt: new Date() }
            });
            return { ok: true, message: "Task queued for rerun" };
        }

        if (actionType === "kill-task") {
            const jobId = formData.get("jobId");
            if (jobId) {
                const job = await prisma.priceJob.findUnique({ where: { jobId } });
                if (job?.note?.includes("Shopify Bulk Operation ID:")) {
                    const opId = job.note.split("ID:")[1].trim();
                    try {
                        await cancelBulkOperation(shop_domain, opId);
                        console.log(`[Support] Cancelled Shopify Bulk Operation ${opId} for job ${jobId}`);
                    } catch (err) {
                        console.error(`[Support] Failed to cancel Shopify Bulk Operation ${opId}:`, err);
                    }
                }
                await prisma.priceJob.update({
                    where: { jobId },
                    data: {
                        status: "cancelled",
                        revertStatus: null,
                        note: null,
                        updatedAt: new Date()
                    }
                });
                return { ok: true, message: "Task killed successfully" };
            } else {
                // Kill the most recent running/processing task for this shop
                const stuckJob = await prisma.priceJob.findFirst({
                    where: {
                        shopDomain: shop_domain,
                        status: { in: ["running", "processing", "reverting", "pending", "revert_pending"] }
                    },
                    orderBy: { createdAt: 'desc' }
                });
                if (stuckJob) {
                    if (stuckJob.note?.includes("Shopify Bulk Operation ID:")) {
                        const opId = stuckJob.note.split("ID:")[1].trim();
                        try {
                            await cancelBulkOperation(shop_domain, opId);
                        } catch (err) {
                            console.error(`[Support] Failed to cancel stuck bulk op ${opId}:`, err);
                        }
                    }
                    await prisma.priceJob.update({
                        where: { jobId: stuckJob.jobId },
                        data: {
                            status: "cancelled",
                            revertStatus: null,
                            note: null,
                            updatedAt: new Date()
                        }
                    });
                    return { ok: true, message: `Killed task: ${stuckJob.name || stuckJob.jobId}` };
                }
                return { ok: false, error: "No running tasks found to kill" };
            }
        }

        if (actionType === "sync-check") {
            // Placeholder for sync logic
            return { ok: true, message: "Sync check triggered" };
        }

        if (actionType === "download-report") {
            const allJobs = await prisma.priceJob.findMany({
                where: { shopDomain: shop_domain },
                orderBy: { createdAt: 'desc' }
            });

            // Generate a simple CSV
            const headers = ["Job ID", "Name", "Status", "Products", "Processed", "Created At"];
            const rows = allJobs.map(j => [
                j.jobId,
                j.name || "Untitled",
                j.status,
                j.totalProducts,
                j.processedProducts,
                j.createdAt.toISOString()
            ].join(","));

            const csv = [headers.join(","), ...rows].join("\n");
            return { ok: true, csv, filename: `report_${shop_domain}_${new Date().toISOString().split('T')[0]}.csv` };
        }

        await prisma.adminActionLog.create({
            data: {
                shopDomain: shop_domain,
                actionType: `support_${actionType}`,
                actionPayload: { timestamp: new Date() }
            }
        });
        return { ok: true, message: "Action completed" };
    }

    if (intent === "create-discount") {
        const code = formData.get("code");
        const type = formData.get("type"); // PERCENT | FIXED
        const value = formData.get("value");
        const appliesTo = formData.get("appliesTo"); // MONTHLY | YEARLY | BOTH
        const maxUses = formData.get("maxUses");
        const expiresAt = formData.get("expiresAt");

        console.log(`[DEBUG] Creating Discount: shop=${shop_domain}, code=${code}, type=${type}, value=${value}`);

        try {
            const newDiscount = await prisma.discountCode.create({
                data: {
                    code,
                    type,
                    value: parseFloat(value),
                    appliesTo,
                    maxUses: maxUses ? parseInt(maxUses) : null,
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                    createdByShop: shop_domain,
                    isActive: true
                }
            });
            console.log("[DEBUG] Discount created successfully:", newDiscount.id);

            await prisma.adminActionLog.create({
                data: {
                    shopDomain: shop_domain,
                    actionType: "create_discount",
                    actionPayload: { code, type, value, appliesTo }
                }
            });

            return { ok: true, message: "Discount code created" };
        } catch (e) {
            console.error("[ERROR] Failed to create discount:", e);
            return { ok: false, error: e.message || "Failed to create discount" };
        }
    }

    if (intent === "toggle-discount") {
        const id = formData.get("id");
        const isActive = formData.get("isActive") === "true";

        await prisma.discountCode.update({
            where: { id },
            data: { isActive }
        });

        return { ok: true, message: `Discount ${isActive ? 'enabled' : 'disabled'}` };
    }

    if (intent === "delete-discount") {
        const id = formData.get("id");
        await prisma.discountCode.delete({ where: { id } });
        return { ok: true, message: "Discount deleted" };
    }

    if (intent === "danger-action") {
        const actionType = formData.get("actionType");

        if (actionType === "clear-tasks") {
            await prisma.priceJob.deleteMany({ where: { shopDomain: shop_domain } });
        } else if (actionType === "delete-demo") {
            await prisma.demoProduct.deleteMany({ where: { shop: shop_domain } });
        }

        await prisma.adminActionLog.create({
            data: {
                shopDomain: shop_domain,
                actionType: `danger_${actionType}`,
                actionPayload: { timestamp: new Date() }
            }
        });

        return { ok: true, message: `Action ${actionType} completed` };
    }

    return null;
};

export default function SupportAdminDetail() {
    const { shop, shopifyDetails, shopifyFetchError, analytics, recentTasks, supportNotes, adminLogs, discountCodes, discountFetchError } = useLoaderData();
    const fetcher = useFetcher();
    const navigate = useNavigate();

    const [isDangerModalOpen, setIsDangerModalOpen] = useState(false);
    const [dangerAction, setDangerAction] = useState({ type: "", label: "" });

    // Feature Flags Checkboxes
    const [flags, setFlags] = useState(shop.featureFlags || {});
    const featureKeys = [
        { label: "Enable bulk inventory edit", key: "inventory" },
        { label: "Enable metafields edit", key: "metafields" },
        { label: "Enable revert feature", key: "revert" },
        { label: "Enable scheduled tasks", key: "scheduling" },
        { label: "Enable tags editing", key: "tags" },
        { label: "Enable weight editing", key: "weight" },
        { label: "Enable vendor editing", key: "vendor" },
        { label: "Enable taxable status", key: "taxable" },
        { label: "Enable shipping status", key: "shipping" }
    ];

    const handleFlagChange = (key, value) => {
        const newFlags = { ...flags, [key]: value };
        setFlags(newFlags);
        const fd = new FormData();
        fd.append("intent", "update-flags");
        fd.append("flags", JSON.stringify(newFlags));
        fetcher.submit(fd, { method: "post" });
    };

    const formatDate = (dateString) => {
        if (!dateString) return "N/A";
        return new Date(dateString).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
    };

    const [toastMsg, setToastMsg] = useState("");
    const showToast = useCallback((msg) => setToastMsg(msg), []);
    const toastMarkup = toastMsg ? (
        <Toast content={toastMsg} onDismiss={() => setToastMsg("")} />
    ) : null;

    useEffect(() => {
        if (fetcher.data?.ok && fetcher.data?.message) {
            showToast(fetcher.data.message);
        }
        if (fetcher.data?.ok && fetcher.data?.csv) {
            const blob = new Blob([fetcher.data.csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fetcher.data.filename || 'report.csv';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            showToast("Report download started");
        }
    }, [fetcher.data, showToast]);

    return (
        <Frame>
            <Page fullWidth>
                {toastMarkup}
                <BlockStack gap="600">
                    {/* Premium Hero Header */}
                    <div className="premium-dashboard-hero" style={{ padding: '32px 48px', borderRadius: '20px' }}>
                        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <BlockStack gap="200">
                                <div
                                    onClick={() => navigate("/app/support-admin")}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}
                                >
                                    <Icon source={ChevronLeftIcon} tone="inherit" />
                                    <Text as="span" variant="bodyMd" tone="inherit">Back to Stores List</Text>
                                </div>
                                <Text as="h1" variant="heading2xl" fontWeight="bold">
                                    Support: {shopifyDetails?.name || shop.shopName || shop.shop}
                                </Text>
                                <Badge tone={shop.isInstalled ? 'success' : 'critical'}>
                                    {shop.isInstalled ? 'INSTALLED' : 'UNINSTALLED'}
                                </Badge>
                            </BlockStack>

                            <InlineStack gap="300">
                                <Button icon={ExternalIcon} onClick={() => window.open(`https://${shop.shop}/admin`, "_blank")}>Shopify Admin</Button>
                                <Button variant="primary" onClick={() => window.open(`https://${shop.shop}`, "_blank")}>Visit Store</Button>
                            </InlineStack>
                        </div>
                    </div>

                    <Layout>
                        <Layout.Section variant="oneThird">
                            <BlockStack gap="500">
                                {/* Shopify Owner Details */}
                                <Card padding="500">
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Store Owner Details</Text>
                                        <Divider />
                                        {shopifyDetails ? (
                                            <BlockStack gap="300">
                                                <SummaryItem label="Owner" value={shopifyDetails.name} />
                                                <SummaryItem label="Email" value={shopifyDetails.email} />
                                                <SummaryItem label="Plan" value={<Badge tone="info">{shopifyDetails.plan?.displayName}</Badge>} />
                                                <SummaryItem label="App Plan" value={<InlineStack gap="100"><Badge tone="success">{shop.planName || shop.plan}</Badge><Text as="span" tone="subdued">{`($${shop.planPrice}/${shop.billingInterval})`}</Text></InlineStack>} />
                                                <SummaryItem label="Discount Applied" value={shop.activeDiscountCode ? `${shop.activeDiscountCode} (-$${shop.activeDiscountAmount})` : "None"} />
                                                <SummaryItem label="Country" value={shopifyDetails.billingAddress?.country || "N/A"} />
                                                <SummaryItem label="Currency" value={shopifyDetails.currencyCode} />
                                                <SummaryItem label="Timezone" value={shopifyDetails.ianaTimezone} />
                                            </BlockStack>
                                        ) : (
                                            <BlockStack gap="300">
                                                <Banner tone="warning">
                                                    <p>{shopifyFetchError || "Cannot fetch live Shopify metadata. Session might be expired."}</p>
                                                    <p style={{ marginTop: '8px', fontSize: '13px' }}>Showing local database fallback:</p>
                                                </Banner>
                                                <SummaryItem label="Shop Name" value={shop.shopName || "N/A"} />
                                                <SummaryItem label="Internal ID" value={shop.shop} />
                                                <SummaryItem label="Email (Local)" value={shop.email || "N/A"} />
                                                <SummaryItem label="Plan (Local)" value={<Badge tone="info">{shop.planName || shop.plan}</Badge>} />
                                                <SummaryItem label="App Plan" value={<InlineStack gap="100"><Badge tone="success">{shop.planName || shop.plan}</Badge><Text as="span" tone="subdued">{`($${shop.planPrice}/${shop.billingInterval})`}</Text></InlineStack>} />
                                                <SummaryItem label="Discount Applied" value={shop.activeDiscountCode ? `${shop.activeDiscountCode} (-$${shop.activeDiscountAmount})` : "None"} />
                                                <SummaryItem label="Billing Status" value={(!shop.isInstalled && shop.billingStatus === 'ACTIVE') ? 'Cancelled' : shop.billingStatus} />
                                                <SummaryItem label="Installed At" value={formatDate(shop.installedAt)} />
                                                <SummaryItem label="Last Seen" value={formatDate(shop.lastSeenAt)} />
                                                {shop.uninstalledAt && <SummaryItem label="Uninstalled At" value={formatDate(shop.uninstalledAt)} />}
                                            </BlockStack>
                                        )}
                                    </BlockStack>
                                </Card>

                                {/* Feature Flags */}
                                <Card padding="500">
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Feature Management</Text>
                                        <Divider />
                                        <BlockStack gap="300">
                                            {featureKeys.map((f) => (
                                                <Checkbox
                                                    key={f.key}
                                                    label={f.label}
                                                    checked={!!flags[f.key]}
                                                    onChange={(val) => handleFlagChange(f.key, val)}
                                                />
                                            ))}
                                        </BlockStack>
                                    </BlockStack>
                                </Card>

                                {/* Internal Logs */}
                                <Card padding="500">
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Recent Admin Actions</Text>
                                        <Divider />
                                        <BlockStack gap="200">
                                            {adminLogs.map((log, i) => (
                                                <Box key={i} padding="200" background="bg-surface-secondary" borderRadius="200">
                                                    <BlockStack gap="100">
                                                        <Text variant="bodySm" fontWeight="bold">{log.actionType}</Text>
                                                        <Text variant="bodyXs" tone="subdued">{formatDate(log.createdAt)}</Text>
                                                    </BlockStack>
                                                </Box>
                                            ))}
                                            {adminLogs.length === 0 && <Text tone="subdued">No logs found</Text>}
                                        </BlockStack>
                                    </BlockStack>
                                </Card>
                            </BlockStack>
                        </Layout.Section>

                        <Layout.Section>
                            <BlockStack gap="500">
                                {/* Task Analytics & Support Tools */}
                                <Grid>
                                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 8, lg: 8 }}>
                                        <Grid>
                                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                                <StatCard label="Total Tasks" value={analytics.totalTasks} icon={ProductIcon} />
                                            </Grid.Cell>
                                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                                <StatCard label="Success" value={analytics.completedTasks} icon={CheckCircleIcon} tone="success" />
                                            </Grid.Cell>
                                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                                <StatCard label="Failed" value={analytics.failedTasks} icon={AlertCircleIcon} tone="critical" />
                                            </Grid.Cell>
                                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                                <StatCard label="Reverted" value={analytics.revertedTasks} icon={RefreshIcon} tone="caution" />
                                            </Grid.Cell>
                                        </Grid>
                                    </Grid.Cell>
                                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4 }}>
                                        <Card padding="500">
                                            <BlockStack gap="300">
                                                <Text variant="headingSm" as="h3">Support Quick Tools</Text>
                                                <Button
                                                    icon={RefreshIcon}
                                                    fullWidth
                                                    textAlign="left"
                                                    disabled={!recentTasks.length}
                                                    onClick={() => {
                                                        const lastTask = recentTasks[0];
                                                        if (lastTask) {
                                                            const fd = new FormData();
                                                            fd.append("intent", "support-action");
                                                            fd.append("actionType", "rerun-task");
                                                            fd.append("jobId", lastTask.jobId);
                                                            fetcher.submit(fd, { method: "post" });
                                                        }
                                                    }}
                                                >
                                                    Re-run Last Task
                                                </Button>
                                                <Button
                                                    icon={ListBulletedIcon}
                                                    fullWidth
                                                    textAlign="left"
                                                    onClick={() => {
                                                        const fd = new FormData();
                                                        fd.append("intent", "support-action");
                                                        fd.append("actionType", "view-logs");
                                                        fetcher.submit(fd, { method: "post" });
                                                    }}
                                                >
                                                    View Full Task Logs
                                                </Button>
                                                <Button
                                                    icon={ExportIcon}
                                                    fullWidth
                                                    textAlign="left"
                                                    onClick={() => {
                                                        const fd = new FormData();
                                                        fd.append("intent", "support-action");
                                                        fd.append("actionType", "download-report");
                                                        fetcher.submit(fd, { method: "post" });
                                                    }}
                                                >
                                                    Download Task Report
                                                </Button>
                                                <Button
                                                    icon={RefreshIcon}
                                                    fullWidth
                                                    textAlign="left"
                                                    onClick={() => {
                                                        const fd = new FormData();
                                                        fd.append("intent", "support-action");
                                                        fd.append("actionType", "retry-failed");
                                                        fetcher.submit(fd, { method: "post" });
                                                    }}
                                                >
                                                    Retry Failed Tasks
                                                </Button>
                                                <Button
                                                    icon={DeleteIcon}
                                                    tone="critical"
                                                    fullWidth
                                                    textAlign="left"
                                                    onClick={() => {
                                                        if (confirm("Are you sure you want to kill the current running task?")) {
                                                            const fd = new FormData();
                                                            fd.append("intent", "support-action");
                                                            fd.append("actionType", "kill-task");
                                                            fetcher.submit(fd, { method: "post" });
                                                        }
                                                    }}
                                                >
                                                    Kill Running Task
                                                </Button>
                                                <Button
                                                    icon={MagicIcon}
                                                    fullWidth
                                                    textAlign="left"
                                                    onClick={() => {
                                                        const fd = new FormData();
                                                        fd.append("intent", "support-action");
                                                        fd.append("actionType", "sync-check");
                                                        fetcher.submit(fd, { method: "post" });
                                                    }}
                                                >
                                                    Run Sync Check
                                                </Button>
                                            </BlockStack>
                                        </Card>
                                    </Grid.Cell>
                                </Grid>

                                {/* Internal Support Notes */}
                                <SupportNotesCard shopDomain={shop.shop} existingNotes={supportNotes} />

                                {/* Recent Activity Table */}
                                <Card padding="0">
                                    <Box padding="400">
                                        <Text variant="headingMd" as="h2">Recent Task History</Text>
                                    </Box>
                                    <IndexTable
                                        resourceName={{ singular: 'task', plural: 'tasks' }}
                                        itemCount={recentTasks.length}
                                        headings={[
                                            { title: 'Task Name' },
                                            { title: 'Status' },
                                            { title: 'Date' },
                                            { title: 'Actions' }
                                        ]}
                                        selectable={false}
                                    >
                                        {recentTasks.map((t, i) => (
                                            <IndexTable.Row key={t.jobId} id={t.jobId} position={i}>
                                                <IndexTable.Cell>
                                                    <Text fontWeight="bold" as="span">{t.name}</Text>
                                                </IndexTable.Cell>
                                                <IndexTable.Cell>
                                                    <Badge tone={t.status === 'completed' ? 'success' : 'info'}>{t.status.toUpperCase()}</Badge>
                                                </IndexTable.Cell>
                                                <IndexTable.Cell>{formatDate(t.createdAt)}</IndexTable.Cell>
                                                <IndexTable.Cell>
                                                    <InlineStack gap="200">
                                                        <Button variant="plain" onClick={() => navigate(`/app/tasks/${t.jobId}`)}>Inspect</Button>
                                                        {['running', 'processing', 'reverting', 'pending', 'revert_pending', 'scheduled'].includes(t.status) && (
                                                            <Button
                                                                variant="plain"
                                                                tone="critical"
                                                                onClick={() => {
                                                                    if (confirm("Kill this task?")) {
                                                                        const fd = new FormData();
                                                                        fd.append("intent", "support-action");
                                                                        fd.append("actionType", "kill-task");
                                                                        fd.append("jobId", t.jobId);
                                                                        fetcher.submit(fd, { method: "post" });
                                                                    }
                                                                }}
                                                            >
                                                                Kill
                                                            </Button>
                                                        )}
                                                    </InlineStack>
                                                </IndexTable.Cell>
                                            </IndexTable.Row>
                                        ))}
                                    </IndexTable>
                                </Card>

                                {/* Discount Management */}
                                {discountFetchError && (
                                    <Banner tone="critical" title="Database Error">
                                        <p>Failed to fetch discount codes: {discountFetchError}</p>
                                    </Banner>
                                )}
                                <DiscountManagementCard shopDomain={shop.shop} discountCodes={discountCodes} />

                                {/* Danger Zone */}
                                <Card padding="500">
                                    <Box padding="200">
                                        <BlockStack gap="400">
                                            <InlineStack gap="200" align="start">
                                                <Icon source={AlertBubbleIcon} tone="critical" />
                                                <Text variant="headingMd" as="h2" tone="critical">Danger Zone</Text>
                                            </InlineStack>
                                            <Text as="p" tone="subdued">Destructive operations that affect store data permanently.</Text>
                                            <Divider />
                                            <InlineStack gap="400">
                                                <Button
                                                    tone="critical"
                                                    variant="secondary"
                                                    onClick={() => {
                                                        setDangerAction({ type: "clear-tasks", label: "Reset Customer Tasks" });
                                                        setIsDangerModalOpen(true);
                                                    }}
                                                >
                                                    Reset Tasks
                                                </Button>
                                                <Button
                                                    tone="critical"
                                                    onClick={() => {
                                                        setDangerAction({ type: "delete-demo", label: "Delete Demo Data" });
                                                        setIsDangerModalOpen(true);
                                                    }}
                                                >
                                                    Clear Demo Data
                                                </Button>
                                            </InlineStack>
                                        </BlockStack>
                                    </Box>
                                </Card>
                            </BlockStack>
                        </Layout.Section>
                    </Layout>

                    <Modal
                        open={isDangerModalOpen}
                        onClose={() => setIsDangerModalOpen(false)}
                        title={`Confirm ${dangerAction.label}`}
                        primaryAction={{
                            content: "Confirm Action",
                            destructive: true,
                            onAction: () => {
                                const fd = new FormData();
                                fd.append("intent", "danger-action");
                                fd.append("actionType", dangerAction.type);
                                fetcher.submit(fd, { method: "post" });
                                setIsDangerModalOpen(false);
                            }
                        }}
                        secondaryActions={[{ content: "Cancel", onAction: () => setIsDangerModalOpen(false) }]}
                    >
                        <Modal.Section>
                            <Text as="p">Are you absolutely sure you want to {dangerAction.label.toLowerCase()}? This action is logged and cannot be undone.</Text>
                        </Modal.Section>
                    </Modal>
                </BlockStack>
            </Page>
        </Frame>
    );
}

function DiscountManagementCard({ shopDomain, discountCodes }) {
    const fetcher = useFetcher();
    const [code, setCode] = useState("");
    const [type, setType] = useState("PERCENT");
    const [value, setValue] = useState("20");
    const [appliesTo, setAppliesTo] = useState("BOTH");
    const [maxUses, setMaxUses] = useState("");
    const [expiresAt, setExpiresAt] = useState("");

    const generateCode = () => {
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        setCode(`AXIOM20-${random}`);
    };

    const handleCreate = () => {
        const fd = new FormData();
        fd.append("intent", "create-discount");
        fd.append("code", code);
        fd.append("type", type);
        fd.append("value", value);
        fd.append("appliesTo", appliesTo);
        fd.append("maxUses", maxUses);
        fd.append("expiresAt", expiresAt);
        fetcher.submit(fd, { method: "post" });
        setCode("");
    };

    const toggleDiscount = (id, currentActive) => {
        const fd = new FormData();
        fd.append("intent", "toggle-discount");
        fd.append("id", id);
        fd.append("isActive", (!currentActive).toString());
        fetcher.submit(fd, { method: "post" });
    };

    const deleteDiscount = (id) => {
        if (!confirm("Are you sure you want to delete this discount code?")) return;
        const fd = new FormData();
        fd.append("intent", "delete-discount");
        fd.append("id", id);
        fetcher.submit(fd, { method: "post" });
    };

    return (
        <Card padding="500">
            <BlockStack gap="400">
                <InlineStack gap="200" align="center">
                    <Icon source={CashDollarIcon} tone="subdued" />
                    <Text variant="headingMd" as="h2">Discount Management</Text>
                </InlineStack>
                <Divider />

                {fetcher.data?.ok === false && (
                    <Banner tone="critical">
                        <p>{fetcher.data.error}</p>
                    </Banner>
                )}
                {fetcher.data?.ok === true && fetcher.data.message && (
                    <Banner tone="success">
                        <p>{fetcher.data.message}</p>
                    </Banner>
                )}
                <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                        <TextField
                            label="Discount Code"
                            value={code}
                            onChange={setCode}
                            autoComplete="off"
                            suffix={<Button variant="plain" onClick={generateCode}>Generate</Button>}
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                        <Select
                            label="Value Type"
                            options={[
                                { label: 'Percentage (%)', value: 'PERCENT' },
                                { label: 'Fixed Amount (Cents)', value: 'FIXED' }
                            ]}
                            value={type}
                            onChange={setType}
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                        <TextField
                            label="Value"
                            type="number"
                            value={value}
                            onChange={setValue}
                            autoComplete="off"
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                        <Select
                            label="Applies To"
                            options={[
                                { label: 'Both Monthly & Yearly', value: 'BOTH' },
                                { label: 'Monthly Only', value: 'MONTHLY' },
                                { label: 'Yearly Only', value: 'YEARLY' }
                            ]}
                            value={appliesTo}
                            onChange={setAppliesTo}
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                        <TextField
                            label="Max Uses (Optional)"
                            type="number"
                            value={maxUses}
                            onChange={setMaxUses}
                            autoComplete="off"
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                        <TextField
                            label="Expiry Date"
                            type="date"
                            value={expiresAt}
                            onChange={setExpiresAt}
                            autoComplete="off"
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 12, lg: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                            <Button variant="primary" onClick={handleCreate} loading={fetcher.state !== "idle"}>Create Discount</Button>
                        </div>
                    </Grid.Cell>
                </Grid>

                <div style={{ marginTop: '24px' }}>
                    <Text variant="headingSm" as="h3">Existing Discounts</Text>
                    <div style={{ marginTop: '12px' }}>
                        <IndexTable
                            resourceName={{ singular: 'discount', plural: 'discounts' }}
                            itemCount={discountCodes.length}
                            headings={[
                                { title: 'Code' },
                                { title: 'Type' },
                                { title: 'Value' },
                                { title: 'Uses' },
                                { title: 'Status' },
                                { title: 'Actions' }
                            ]}
                            selectable={false}
                        >
                            {discountCodes.map((d, i) => (
                                <IndexTable.Row key={d.id} id={d.id} position={i}>
                                    <IndexTable.Cell>
                                        <Text fontWeight="bold" as="span">{d.code}</Text>
                                    </IndexTable.Cell>
                                    <IndexTable.Cell>{d.type}</IndexTable.Cell>
                                    <IndexTable.Cell>{d.value} {d.type === 'PERCENT' ? '%' : '¢'}</IndexTable.Cell>
                                    <IndexTable.Cell>{d.usedCount} / {d.maxUses || '∞'}</IndexTable.Cell>
                                    <IndexTable.Cell>
                                        <Badge tone={d.isActive ? 'success' : 'subdued'}>{d.isActive ? 'Active' : 'Disabled'}</Badge>
                                    </IndexTable.Cell>
                                    <IndexTable.Cell>
                                        <InlineStack gap="200">
                                            <Button variant="plain" onClick={() => toggleDiscount(d.id, d.isActive)}>
                                                {d.isActive ? 'Disable' : 'Enable'}
                                            </Button>
                                            <Button variant="plain" tone="critical" onClick={() => deleteDiscount(d.id)}>Delete</Button>
                                        </InlineStack>
                                    </IndexTable.Cell>
                                </IndexTable.Row>
                            ))}
                        </IndexTable>
                        {discountCodes.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '20px', color: '#6d7175' }}>
                                No discount codes created for this store.
                            </div>
                        )}
                    </div>
                </div>
            </BlockStack>
        </Card>
    );
}

function SummaryItem({ label, value }) {
    return (
        <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">{label}</Text>
            <Text variant="bodySm" fontWeight="medium" as="span">{value}</Text>
        </InlineStack>
    );
}

function StatCard({ label, value, icon, tone }) {
    return (
        <div className="stat-card">
            <Box padding="400">
                <BlockStack gap="100">
                    <InlineStack align="space-between">
                        <Text variant="bodySm" tone={tone} as="p">{label}</Text>
                        <Icon source={icon} tone={tone || "subdued"} />
                    </InlineStack>
                    <Text variant="headingXl" as="p">{value}</Text>
                </BlockStack>
            </Box>
        </div>
    );
}

function SupportNotesCard({ shopDomain, existingNotes }) {
    const fetcher = useFetcher();
    const [note, setNote] = useState("");
    const [priority, setPriority] = useState("Medium");
    const [followUp, setFollowUp] = useState("");

    const handleSave = () => {
        const fd = new FormData();
        fd.append("intent", "save-note");
        fd.append("issueText", note);
        fd.append("priority", priority);
        fd.append("followUpDate", followUp);
        fetcher.submit(fd, { method: "post" });
        setNote("");
    };

    return (
        <Card padding="500">
            <BlockStack gap="400">
                <InlineStack gap="200" align="center">
                    <Icon source={NoteIcon} tone="subdued" />
                    <Text variant="headingMd" as="h2">Internal Support Notes</Text>
                </InlineStack>
                <Divider />
                <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 12, lg: 12 }}>
                        <TextField
                            label="Issue Description"
                            multiline={3}
                            value={note}
                            onChange={setNote}
                            placeholder="Describe the issue or conversation..."
                            autoComplete="off"
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4 }}>
                        <Select
                            label="Priority"
                            options={["Low", "Medium", "High", "Urgent"]}
                            value={priority}
                            onChange={setPriority}
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4 }}>
                        <TextField
                            label="Follow-up Date"
                            type="date"
                            value={followUp}
                            onChange={setFollowUp}
                            autoComplete="off"
                        />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4 }}>
                        <div style={{ paddingTop: '24px' }}>
                            <Button fullWidth variant="primary" onClick={handleSave} loading={fetcher.state !== "idle"}>Save Note</Button>
                        </div>
                    </Grid.Cell>
                </Grid>

                <div style={{ marginTop: '16px' }}>
                    <Text variant="headingSm" as="h3">Previous Notes</Text>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', marginTop: '12px' }}>
                        <BlockStack gap="200">
                            {existingNotes.map((n) => (
                                <Box key={n.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <BlockStack gap="100">
                                        <InlineStack align="space-between">
                                            <Badge tone={n.priority === 'Urgent' ? 'critical' : 'info'}>{n.priority}</Badge>
                                            <Text variant="bodyXs" tone="subdued">{new Date(n.createdAt).toLocaleDateString()}</Text>
                                        </InlineStack>
                                        <Text as="p">{n.issueText}</Text>
                                        {n.followUpDate && (
                                            <Text variant="bodyXs" tone="caution">Follow-up: {new Date(n.followUpDate).toLocaleDateString()}</Text>
                                        )}
                                    </BlockStack>
                                </Box>
                            ))}
                        </BlockStack>
                    </div>
                </div>
            </BlockStack>
        </Card>
    );
}
