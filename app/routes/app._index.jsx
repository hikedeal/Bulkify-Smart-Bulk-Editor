import { useLoaderData, useNavigate, useRevalidator, redirect } from "react-router";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Grid,
  Badge,
  IndexTable,
  Button,
  InlineStack,
  Icon,
} from "@shopify/polaris";
import "../styles/tasks.css";
import {
  CheckIcon,
  RefreshIcon,
  CalendarIcon,
  AlertBubbleIcon,
  PlusIcon,
  ProductListIcon,
  UndoIcon,
  CashDollarIcon,
  InventoryIcon,
  ClockIcon,
  SearchIcon,
  MetafieldsIcon,
  GlobeIcon,
  ChartLineIcon,
  HashtagIcon,
  ViewIcon,
  CreditCardIcon,
  PackageIcon,
  StoreIcon,
  CheckCircleIcon,
  LockIcon
} from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { isProPlan } from "../utils/billing";

export const loader = async ({ request }) => {
  const { session, admin, redirect: shopifyRedirect } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Check Shop Existence & Plan
  let shopRecord = await prisma.shop.findUnique({
    where: { shop: shop },
    select: { plan: true, planName: true, billingStatus: true }
  });

  if (!shopRecord) {
    // New install - fetch details and create record
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

      shopRecord = await prisma.shop.create({
        data: {
          shop: shop,
          shopDomain: shop,
          shopName: shopData.name,
          email: shopData.email,
          plan: "FREE",
          planName: "FREE",
          billingStatus: "FREE",
          billingInterval: "FREE",
          planPrice: 0
        }
      });

      await prisma.shopSettings.upsert({
        where: { shopDomain: shop },
        update: {
          shopName: shopData.name,
          contactEmail: shopData.email,
          timezone: shopData.ianaTimezone,
          updatedAt: new Date()
        },
        create: {
          shopDomain: shop,
          shopName: shopData.name,
          contactEmail: shopData.email,
          timezone: shopData.ianaTimezone,
          updatedAt: new Date()
        }
      });

    } catch (err) {
      console.error("Error creating shop record:", err);
    }
    return shopifyRedirect("/app/plans");
  }

  // 2. Persistent Subscription Check (Sync if not PRO - Cached for 6 hours)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const needsSubCheck = !isProPlan(shopRecord.planName || shopRecord.plan) &&
    (!shopRecord.lastSubscriptionCheck ||
      (new Date().getTime() - new Date(shopRecord.lastSubscriptionCheck).getTime() > SIX_HOURS));

  if (needsSubCheck) {
    const { checkSubscription } = await import("../services/billing.server");
    const activeSubscriptions = await checkSubscription(admin);

    // Update check timestamp regardless of result to prevent spamming API
    let updateData = { lastSubscriptionCheck: new Date() };

    if (activeSubscriptions && activeSubscriptions.length > 0) {
      const sub = activeSubscriptions[0];
      const isPro = isProPlan(sub.name); // Using the robust utility
      if (isPro) {
        const isYearly = sub.name.toLowerCase().includes("yearly") || sub.name.toLowerCase().includes("annual");
        const billing_price = parseFloat(sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");

        updateData = {
          ...updateData,
          plan: isYearly ? "PRO_YEARLY" : "PRO_MONTHLY",
          planName: isYearly ? "PRO_YEARLY" : "PRO_MONTHLY",
          billingStatus: "ACTIVE",
          billingInterval: isYearly ? "YEARLY" : "MONTHLY",
          planPrice: billing_price,
          billingChargeId: sub.id,
          updatedAt: new Date()
        };

        console.log("Dashboard: Successfully synced PRO subscription for", shop);

        // Update local object for this request
        shopRecord.plan = updateData.plan;
        shopRecord.planName = updateData.planName;
        shopRecord.billingStatus = "ACTIVE";
      }
    }

    await prisma.shop.update({
      where: { shop: shop },
      data: updateData
    });
  }

  // If plan is still null or pending selection, force redirect
  if (!shopRecord.plan && !shopRecord.planName) {
    return { shouldRedirectToPlans: true };
  }

  // Fetch stats from Prisma in parallel
  const [
    totalJobsCount,
    activeJobsCount,
    completedJobsCount,
    revertedJobsCount,
    failedJobsCount,
    allJobsAgg,
    recentJobs,
    settings
  ] = await Promise.all([
    prisma.priceJob.count({ where: { shopDomain: shop } }),
    prisma.priceJob.count({ where: { shopDomain: shop, status: { in: ["scheduled", "running"] } } }),
    prisma.priceJob.count({
      where: {
        shopDomain: shop,
        status: { in: ["completed", "archived"] },
        revertStatus: { not: "reverted" }
      }
    }),
    prisma.priceJob.count({
      where: {
        shopDomain: shop,
        OR: [
          { status: "reverted" },
          { revertStatus: "reverted" }
        ]
      }
    }),
    prisma.priceJob.count({ where: { shopDomain: shop, status: "failed" } }),
    prisma.priceJob.aggregate({
      where: { shopDomain: shop },
      _sum: { processedProducts: true }
    }),
    prisma.priceJob.findMany({ where: { shopDomain: shop }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.shopSettings.findUnique({ where: { shopDomain: shop } })
  ]);

  const totalProducts = Number(allJobsAgg?._sum?.processedProducts || 0);

  return {
    stats: {
      total: totalJobsCount,
      active: activeJobsCount,
      completed: completedJobsCount,
      reverted: revertedJobsCount,
      failed: failedJobsCount,
      total_products: totalProducts,
      shop_name: settings?.shopName,
      timezone: settings?.timezone,
      plan: shopRecord.plan || 'FREE'
    },
    recentJobs: recentJobs || [],
  };
};

export default function Index() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (data && data.shouldRedirectToPlans) {
      navigate("/app/plans");
    }
  }, [data, navigate]);

  // If redirecting, return null or spinner
  if (!data || data.shouldRedirectToPlans) return null;

  const { stats, recentJobs } = data;

  // Auto-refresh stats every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [revalidator]);

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTimeBasedGreeting = () => {
    try {
      const timezone = stats.timezone || "UTC";
      // Get current hour in store's timezone
      const hour = parseInt(new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone
      }).format(new Date()));

      if (hour < 12) return "Good morning";
      if (hour < 18) return "Good afternoon";
      return "Good evening";
    } catch (e) {
      // Fallback for invalid timezone
      const hour = new Date().getHours();
      if (hour < 12) return "Good morning";
      if (hour < 18) return "Good afternoon";
      return "Good evening";
    }
  };

  const metrics = [
    { label: "Total Tasks", value: stats.total.toString(), icon: ProductListIcon, color: "info" },
    { label: "Total products updated", value: (stats.total_products || 0).toLocaleString(), icon: CheckIcon, color: "info" },
    { label: "Tasks completed", value: stats.completed.toString(), icon: CheckIcon, color: "success" },
    { label: "Tasks scheduled", value: stats.active.toString(), icon: CalendarIcon, color: "warning", badge: stats.active > 0 ? "Active" : null },
    { label: "Tasks reverted", value: stats.reverted.toString(), icon: UndoIcon, color: "critical" },
    { label: "Tasks failed", value: stats.failed.toString(), icon: AlertBubbleIcon, color: "critical" },
  ];

  const quickActions = [
    { title: "Update Prices", desc: "Bulk edit product prices", type: "price", icon: CashDollarIcon, color: "#eff6ff", tone: "info", isPro: false },
    { title: "Compare Price", desc: "Edit compare-at prices", type: "compare_price", icon: ChartLineIcon, color: "#f5f3ff", tone: "info", isPro: false },
    { title: "Product Status", desc: "Set Active, Draft, Archived", type: "status", icon: ViewIcon, color: "#f1f5f9", tone: "base", isPro: false },
    { title: "Product Cost", desc: "Track margins accurately", type: "cost", icon: CreditCardIcon, color: "#fff7ed", tone: "warning", isPro: false },
    { title: "Sync Inventory", desc: "Update stock levels", type: "inventory", icon: InventoryIcon, color: "#fef3c7", tone: "warning", isPro: true },
    { title: "Manage Tags", desc: "Add or remove tags", type: "tags", icon: HashtagIcon, color: "#dcfce7", tone: "success", isPro: true },
    { title: "Metafields", desc: "Edit custom metafields", type: "metafield", icon: MetafieldsIcon, color: "#ecfeff", tone: "info", isPro: true },
    { title: "Product Type", desc: "Categorize your products", type: "product_type", icon: ProductListIcon, color: "#fae8ff", tone: "info", isPro: true },
    { title: "Change Vendor", desc: "Update product vendors", type: "vendor", icon: StoreIcon, color: "#fdf2f8", tone: "info", isPro: true },
    { title: "Edit Weight", desc: "Update shipping weights", type: "weight", icon: PackageIcon, color: "#fff1f2", tone: "critical", isPro: true },
    { title: "Tax Settings", desc: "Toggle taxable status", type: "taxable", icon: CheckCircleIcon, color: "#f0fdf4", tone: "success", isPro: true },
    { title: "Shipping", desc: "Requires shipping toggle", type: "requires_shipping", icon: GlobeIcon, color: "#e0f2fe", tone: "info", isPro: true },
  ];

  return (
    <Page fullWidth>
      <BlockStack gap="800">
        {/* Premium Dashboard Hero Section */}
        <div className="premium-dashboard-hero">
          <div className="hero-background-shapes">
            <div className="hero-shape hero-shape-1" />
            <div className="hero-shape hero-shape-2" />
          </div>

          <div className="hero-content">
            <div className="hero-badge-container">
              <div className="hero-badge version">v2.4 Live</div>
              <div className="hero-sync-text">System synchronized with {stats.timezone || "Asia/Kolkata"}</div>
            </div>

            <Text as="h1" variant="heading3xl" fontWeight="bold" className="hero-title">
              {getTimeBasedGreeting()},
              <br />
              {stats.shop_name || 'Merchant'}.
            </Text>

            <div className="hero-subtitle">
              <Text as="p" variant="bodyLg">
                Manage your prices, inventory, and campaigns with surgical precision.
              </Text>
            </div>
          </div>

          <div className="hero-stats">
            <div className="hero-glass-card">
              <div className="hero-stat-label">Total Updates</div>
              <div className="hero-stat-value">{stats.total || 0}</div>
            </div>
            <div className="hero-glass-card">
              <div className="hero-stat-label">Active Tasks</div>
              <div className="hero-stat-value">{stats.active || 0}</div>
            </div>
          </div>
        </div>

        {/* Quick Actions Grid */}
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">Quick Actions</Text>
          <Grid>
            {quickActions.map((action, i) => {
              const isLocked = action.isPro && !isProPlan(stats.plan);

              return (
                <Grid.Cell key={i} columnSpan={{ xs: 6, sm: 3, md: 2, lg: 2 }}>
                  <div
                    onClick={() => {
                      if (isLocked) {
                        navigate("/app/plans");
                      } else {
                        navigate(action.type ? `/app/tasks/new?type=${action.type}` : "/app/tasks/new");
                      }
                    }}
                    className={`action-card ${isLocked ? 'locked-feature' : ''}`}
                    style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}
                  >
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <div style={{ background: action.color, width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon source={action.icon} tone={action.tone} />
                        </div>
                        {isLocked && (
                          <div style={{ background: '#fef2f2', padding: '4px', borderRadius: '50%', display: 'flex' }}>
                            <Icon source={LockIcon} tone="critical" />
                          </div>
                        )}
                      </InlineStack>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h3" variant="headingMd" fontWeight="semibold">{action.title}</Text>
                          {isLocked && <Badge tone="critical" size="small">PRO</Badge>}
                        </InlineStack>
                        <Text as="p" tone="subdued">{action.desc}</Text>
                      </BlockStack>
                    </BlockStack>
                  </div>
                </Grid.Cell>
              );
            })}
          </Grid>
        </BlockStack>

        {/* Analytics Row - Colorful Cards */}
        <MetricCards metrics={metrics} />

        <Layout>
          {/* Main Content: Recent Activity */}
          <Layout.Section>
            <Card padding="0">
              <div style={{ padding: '24px', borderBottom: '1px solid #f1f1f1' }}>
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingLg">Recent Activity</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Your latest bulk edit operations</Text>
                  </BlockStack>
                  <Button variant="plain" onClick={() => navigate("/app/tasks")}>View all tasks</Button>
                </InlineStack>
              </div>

              {recentJobs.length === 0 ? (
                <div style={{ padding: '60px', textAlign: 'center' }}>
                  <BlockStack gap="400" inlineAlign="center">
                    <div style={{ background: '#f3f4f6', borderRadius: '50%', padding: '20px', width: 'fit-content' }}>
                      <Icon source={AlertBubbleIcon} tone="subdued" />
                    </div>
                    <Text as="p" variant="bodyLg" tone="subdued">No activity yet.</Text>
                    <Button onClick={() => navigate("/app/tasks/new")}>Create your first task</Button>
                  </BlockStack>
                </div>
              ) : (
                <IndexTable
                  resourceName={{ singular: "job", plural: "jobs" }}
                  itemCount={recentJobs.length}
                  headings={[
                    { title: "Status" },
                    { title: "Task Info" },
                    { title: "Date" },
                    { title: "" }
                  ]}
                  selectable={false}
                >
                  {recentJobs.map((job, index) => {
                    const config = job.configuration || {};
                    const fieldLabel = {
                      price: "Price",
                      compare_price: "Compare Price",
                      cost: "Cost",
                      inventory: "Inventory",
                      tags: "Tags",
                      status: "Status",
                      metafield: "Metafield"
                    }[config.fieldToEdit] || config.fieldToEdit;

                    let configSummary = "";
                    if (config.fieldToEdit === 'status') {
                      configSummary = `Set to ${config.editValue}`;
                    } else if (config.fieldToEdit === 'tags') {
                      configSummary = config.editMethod === 'add_tags' ? "Add tags" : (config.editMethod === 'remove_tags' ? "Remove tags" : "Replace tags");
                    } else if (config.fieldToEdit === 'metafield') {
                      configSummary = `${config.metafieldNamespace}.${config.metafieldKey} = ${config.editValue}`;
                    } else {
                      const isPercentage = config.editMethod?.includes("percentage");
                      const action = config.editMethod?.includes("inc") ? "+" : (config.editMethod?.includes("dec") ? "-" : "");
                      const value = config.editValue || "0";
                      configSummary = `${action}${value}${isPercentage ? '%' : '$'}`;
                    }

                    return (
                      <IndexTable.Row id={job.jobId} key={job.jobId} position={index}>
                        <IndexTable.Cell>
                          <Badge
                            tone={
                              job.status === "completed" ? "success" :
                                job.status === "running" ? "attention" :
                                  job.status === "failed" ? "critical" : "info"
                            }
                          >
                            {job.status.toUpperCase()}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="bold">
                              {job.name || "Untitled Task"}
                            </Text>
                            <InlineStack gap="200" align="start">
                              <Badge tone="new">{fieldLabel}</Badge>
                              <Text as="span" tone="subdued">{configSummary}</Text>
                            </InlineStack>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="p" variant="bodySm" tone="subdued">{formatDate(job.createdAt)}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button size="micro" onClick={() => navigate(`/app/tasks/${job.jobId}`)}>View</Button>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>

          {/* Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="300">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ background: '#e0f2fe', padding: '8px', borderRadius: '6px' }}>
                      <Icon source={RefreshIcon} tone="info" />
                    </div>
                    <Text as="h2" variant="headingMd">System Status</Text>
                  </div>
                  <Text as="p" tone="subdued">System is running normally.
                    {stats.active > 0 ? ` Processing ${stats.active} jobs.` : ' No active jobs.'}
                  </Text>
                  <Button
                    fullWidth
                    variant="plain"
                    textAlign="left"
                    onClick={() => window.location.reload()}
                  >
                    Check for update
                  </Button>
                </BlockStack>
              </Card>

              <div className="pro-tip-card">
                <div className="glass-element" style={{ top: '-50px', right: '-50px', width: '120px', height: '120px', background: 'rgba(255,255,255,0.1)', filter: 'none' }} />
                <BlockStack gap="400">
                  <div style={{ position: 'relative', zIndex: 1 }}>
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd" fontWeight="bold">💡 Pro Tip</Text>
                      <Text as="p" variant="bodyMd">
                        <span style={{ opacity: 0.9 }}>
                          Use tags to group products for seasonal sales. You can then bulk edit prices just for that tag!
                        </span>
                      </Text>
                    </BlockStack>
                  </div>
                  <Button variant="primary" onClick={() => navigate('/app/tasks/new?type=tags')}>Try Tagging</Button>
                </BlockStack>
              </div>
            </BlockStack>
          </Layout.Section>
        </Layout>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <div style={{ padding: '16px 0' }}>
                <Text as="h2" variant="headingLg">Frequently Asked Questions</Text>
              </div>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#f0fdf4', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={UndoIcon} tone="success" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">Can I revert my changes?</Text>
                        <Text as="p" tone="subdued">Yes! Every campaign is fully reversible. Just go to the tasks page and click "Revert" on any completed job.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#eff6ff', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={CalendarIcon} tone="info" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">How does scheduling work?</Text>
                        <Text as="p" tone="subdued">You can set a start time for any task. The app will automatically run the task at that time, even if you're offline.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#fff7ed', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={CashDollarIcon} tone="warning" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">Can I edit product cost?</Text>
                        <Text as="p" tone="subdued">Absolutely. You can bulk update product cost, which helps in tracking your margins more accurately after edits.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#f8fafc', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={InventoryIcon} tone="base" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">Is there a limit on products?</Text>
                        <Text as="p" tone="subdued">No, our system is built to handle stores of all sizes. It processes items in batches for maximum reliability.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#fdf2f8', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={ClockIcon} tone="critical" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">Can I schedule a revert?</Text>
                        <Text as="p" tone="subdued">Yes, you can schedule a task to automatically revert its changes at a specific date and time, perfect for sales.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#f5f3ff', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={SearchIcon} tone="info" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">What fields can I edit?</Text>
                        <Text as="p" tone="subdued">You can edit prices, compare-at prices, costs, inventory levels, tags, product status, and even custom Metafields.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#ecfeff', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={MetafieldsIcon} tone="success" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">How do I edit Metafields?</Text>
                        <Text as="p" tone="subdued">Simply select the 'Metafield' task type, enter your namespace and key, and specify the new values you want to set.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <div style={{ background: '#fff1f2', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon source={GlobeIcon} tone="critical" />
                      </div>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd" fontWeight="semibold">Are markets supported?</Text>
                        <Text as="p" tone="subdued">Yes, we support Shopify Markets. You can choose to apply price changes to specific markets or the entire store.</Text>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function MetricCards({ metrics }) {
  const getSubtleColor = (tone) => {
    switch (tone) {
      case 'success': return '#f0fdf4';
      case 'info': return '#eff6ff';
      case 'attention': return '#fff7ed';
      case 'critical': return '#fef2f2';
      case 'warning': return '#fff7ed';
      default: return '#f1f5f9';
    }
  };

  return (
    <Grid>
      {metrics.map((metric, index) => (
        <Grid.Cell key={index} columnSpan={{ xs: 6, sm: 4, md: 2, lg: 2 }}>
          <div className="stat-card-static" style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <div style={{
                  background: getSubtleColor(metric.color),
                  borderRadius: '12px',
                  padding: '10px',
                  display: 'flex'
                }}>
                  <Icon source={metric.icon} tone={metric.color} />
                </div>
                {metric.badge && <Badge tone="attention">{metric.badge}</Badge>}
              </InlineStack>
              <BlockStack gap="100">
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {metric.value}
                </Text>
                <Text variant="bodyMd" tone="subdued" fontWeight="medium" as="span">
                  {metric.label}
                </Text>
              </BlockStack>
            </BlockStack>
          </div>
        </Grid.Cell>
      ))}
    </Grid>
  );
}
