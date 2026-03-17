import { redirect, useLoaderData, useSearchParams, useSubmit, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
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
    DataTable,
    Tooltip,
    Icon,
    Divider,
} from "@shopify/polaris";
import { useState, useCallback, useEffect, useMemo } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { trackEvent } from "../services/analytics.server";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as ChartTooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Legend,
    Cell,
    PieChart,
    Pie
} from "recharts";
import {
    InfoIcon,
    SearchIcon,
    PersonIcon,
    StoreIcon,
    PersonExitIcon,
    StarFilledIcon,
    CashDollarIcon,
    ProductAddIcon,
    CheckCircleIcon,
    ChartLineIcon,
    ChevronLeftIcon,
    CalendarIcon,
    ExternalIcon
} from "@shopify/polaris-icons";

import { ADMIN_ALLOWLIST } from "../constants";

interface FunnelStep {
    name: string;
    count: number;
    conv: string | number;
}

interface TopField {
    field: string;
    count: number;
    percentage: string | number;
}

interface ActiveStore {
    shop_name: string;
    domain: string;
    total: number;
    completed: number;
    failed: number;
    last_date: Date | string;
}

interface ChartDataPoint {
    date: string;
    installs: number;
    tasks: number;
    monthly_rev: number;
    yearly_rev: number;
    total_rev: number;
}

interface DashboardStats {
    totalInstalls: number;
    activeInstalls: number;
    uninstalls: number;
    proUsers: number;
    freeUsers: number;
    monthlySubs: number;
    yearlySubs: number;
    mrr: number;
    arr: number;
    totalRevenueEst: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    revertedTasks: number;
    successRate: number;
    churnRate: number;
}

interface DashboardData {
    stats: DashboardStats;
    funnelSteps: FunnelStep[];
    topFields: TopField[];
    activeStores: ActiveStore[];
    chartData: ChartDataPoint[];
    topPaying: any[];
    recentShops: any[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const adminSecret = process.env.ADMIN_SECRET;
    const headerSecret = request.headers.get("x-admin-secret");

    // Admin check: Shop OR Secret OR Email
    const isAllowedShop = ADMIN_ALLOWLIST.includes(session.shop);
    const isAllowedSecret = adminSecret && headerSecret === adminSecret;

    // Check email if not allowed by shop/secret
    let isAllowedEmail = false;
    if (!isAllowedShop && !isAllowedSecret) {
        const settings = await prisma.shopSettings.findUnique({
            where: { shopDomain: session.shop },
            select: { contactEmail: true }
        });

        const adminEmails = process.env.ADMIN_EMAILS?.split(",") || [];
        if (settings?.contactEmail && adminEmails.includes(settings.contactEmail)) {
            isAllowedEmail = true;
        }
    }

    if (!isAllowedShop && !isAllowedSecret && !isAllowedEmail) {
        return redirect("/app/tasks");
    }

    const url = new URL(request.url);
    const dateRange = url.searchParams.get("dateRange") || "30d";
    const search = url.searchParams.get("q") || "";

    // Calculate Date Threshold
    let dateLimit = new Date();
    if (dateRange === "7d") dateLimit.setDate(dateLimit.getDate() - 7);
    else if (dateRange === "30d") dateLimit.setDate(dateLimit.getDate() - 30);
    else if (dateRange === "90d") dateLimit.setDate(dateLimit.getDate() - 90);
    else if (dateRange === "all") dateLimit = new Date(0); // All time
    else dateLimit = new Date(0);

    // 1. Fetch Shops

    // 2. Fetch Tasks (price_jobs)



    // --- Calculations ---
    // --- Optimized Database Queries ---

    // --- Prepare Query Filters ---
    const taskWhere: any = {
        AND: [
            dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}
        ]
    };
    if (search) taskWhere.AND.push({ shopDomain: { contains: search } });

    // --- Consolidated Database Queries (Batch 1) ---
    const [
        totalInstalls, activeInstalls, uninstalls, proUsers, monthlySubs, yearlySubs, cancelledSubs,
        revenueStats,
        totalTasks, completedTasks, failedTasks, revertedTasks
    ] = await Promise.all([
        prisma.shop.count(),
        prisma.shop.count({ where: { uninstalledAt: null } }),
        prisma.shop.count({ where: { uninstalledAt: { not: null } } }),
        prisma.shop.count({ where: { uninstalledAt: null, OR: [{ planName: 'PRO' }, { plan: 'PRO' }, { planName: { startsWith: 'PRO_' } }] } }),
        prisma.shop.count({ where: { uninstalledAt: null, billingInterval: 'MONTHLY', OR: [{ planName: 'PRO' }, { plan: 'PRO' }, { planName: 'PRO_MONTHLY' }] } }),
        prisma.shop.count({ where: { uninstalledAt: null, billingInterval: 'YEARLY', OR: [{ planName: 'PRO' }, { plan: 'PRO' }, { planName: 'PRO_YEARLY' }] } }),
        prisma.shop.count({ where: { OR: [{ billingStatus: 'CANCELLED' }, { billingStatus: 'FROZEN' }, { AND: [{ plan: 'FREE' }, { uninstalledAt: { not: null } }] }] } }),
        prisma.shop.aggregate({ where: { uninstalledAt: null, OR: [{ planName: 'PRO' }, { plan: 'PRO' }, { planName: { startsWith: 'PRO_' } }] }, _sum: { planPrice: true, totalSpent: true } }),
        prisma.priceJob.count({ where: taskWhere }),
        prisma.priceJob.count({ where: { ...taskWhere, OR: [{ status: 'completed' }, { status: 'archived' }] } }),
        prisma.priceJob.count({ where: { ...taskWhere, status: 'failed' } }),
        prisma.priceJob.count({ where: { ...taskWhere, OR: [{ status: 'reverted' }, { revertStatus: 'reverted' }] } })
    ]);

    // --- Metrics Calculations ---
    const mrr = (monthlySubs * 15) + (yearlySubs * (150 / 12));
    const arr = mrr * 12;
    const totalRevenueEst = Number(revenueStats._sum.planPrice) || 0;
    const netRevenue = Number(revenueStats._sum.totalSpent) || 0;
    const refundedRevenue = 0;
    const freeUsers = activeInstalls - proUsers;
    const churnRate = totalInstalls > 0 ? (uninstalls / totalInstalls) * 100 : 0;
    const successRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // --- Consolidated Database Queries (Batch 2) ---
    const [
        funnelCounts,
        recentActivity,
        chartJobDates,
        chartShopDates,
        fieldJobs,
        taskGroups,
        topPaying,
        recentShops
    ] = await Promise.all([
        Promise.all([
            prisma.appEvent.groupBy({ by: ['shopDomain'], where: { eventName: 'install', ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) } }).then((r: any[]) => r.length),
            prisma.appEvent.groupBy({ by: ['shopDomain'], where: { eventName: 'plans_opened', ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) } }).then((r: any[]) => r.length),
            prisma.appEvent.groupBy({ by: ['shopDomain'], where: { eventName: 'upgrade_clicked', ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) } }).then((r: any[]) => r.length),
            prisma.appEvent.groupBy({ by: ['shopDomain'], where: { eventName: 'billing_success', ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) } }).then((r: any[]) => r.length),
            prisma.appEvent.groupBy({ by: ['shopDomain'], where: { eventName: 'task_created', ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) } }).then((r: any[]) => r.length),
            prisma.appEvent.groupBy({ by: ['shopDomain'], where: { eventName: 'task_completed', ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) } }).then((r: any[]) => r.length)
        ]),
        prisma.appEvent.findMany({
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: { shop: { select: { shopName: true } } }
        }),
        prisma.priceJob.findMany({
            where: { createdAt: { gte: dateLimit } },
            select: { createdAt: true }
        }),
        prisma.shop.findMany({
            where: { createdAt: { gte: dateLimit } },
            select: { createdAt: true, planName: true, plan: true, planPrice: true, billingInterval: true }
        }),
        prisma.priceJob.findMany({
            where: { createdAt: { gte: dateLimit } },
            select: { configuration: true },
            take: 1000,
            orderBy: { createdAt: 'desc' }
        }),
        prisma.priceJob.groupBy({
            by: ['shopDomain'],
            where: dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {},
            _count: { _all: true },
            _max: { createdAt: true }
        }),
        prisma.shop.findMany({
            where: {
                uninstalledAt: null,
                OR: [{ planName: 'PRO' }, { plan: 'PRO' }, { planName: { startsWith: 'PRO_' } }]
            },
            orderBy: { totalSpent: 'desc' },
            take: 10,
            select: { shop: true, shopName: true, billingInterval: true, billingStatus: true, plan: true, planPrice: true, totalSpent: true, lastPaymentDate: true }
        }),
        prisma.shop.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { shop: true, shopName: true, plan: true, planPrice: true, uninstalledAt: true, createdAt: true }
        })
    ]);

    const [installsCount, openedPlansCount, upgradeClickedCount, billingSuccessCount, createdTaskCount, completedTaskCount] = funnelCounts;
    const billingConversionRate = openedPlansCount > 0 ? (billingSuccessCount / openedPlansCount) * 100 : 0;

    const funnelSteps = [
        { name: 'Installs', count: installsCount, conv: 100 },
        { name: 'Opened Plans', count: openedPlansCount, conv: installsCount > 0 ? (openedPlansCount / installsCount * 100).toFixed(1) : 0 },
        { name: 'Clicked Upgrade', count: upgradeClickedCount, conv: openedPlansCount > 0 ? (upgradeClickedCount / openedPlansCount * 100).toFixed(1) : 0 },
        { name: 'Billing Success', count: billingSuccessCount, conv: upgradeClickedCount > 0 ? (billingSuccessCount / upgradeClickedCount * 100).toFixed(1) : 0 },
        { name: 'Created Task', count: createdTaskCount, conv: billingSuccessCount > 0 ? (createdTaskCount / billingSuccessCount * 100).toFixed(1) : 0 },
        { name: 'Completed Task', count: completedTaskCount, conv: createdTaskCount > 0 ? (completedTaskCount / createdTaskCount * 100).toFixed(1) : 0 },
    ];

    const days = (dateRange === 'all' || dateRange === '90d') ? 90 : (dateRange === '7d' ? 7 : 30);
    const chartDays = Array.from({ length: days }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
    }).reverse();

    const chartData: ChartDataPoint[] = chartDays.map(date => {
        const dInstalls = chartShopDates.filter((s: any) => s.createdAt.toISOString().startsWith(date)).length;
        const dTasks = chartJobDates.filter((j: any) => j.createdAt.toISOString().startsWith(date)).length;
        const dailyProShops = chartShopDates.filter((s: any) => s.createdAt.toISOString().startsWith(date) && (s.plan === 'PRO' || s.planName?.startsWith('PRO')));
        const dRevMonthly = dailyProShops.filter((s: any) => s.billingInterval === 'MONTHLY').reduce((acc: number, s: any) => acc + (Number(s.planPrice) || 15), 0);
        const dRevYearly = dailyProShops.filter((s: any) => s.billingInterval === 'YEARLY').reduce((acc: number, s: any) => acc + (Number(s.planPrice) || 150), 0);

        return {
            date: date.split('-').slice(1).join('/'),
            installs: dInstalls,
            tasks: dTasks,
            monthly_rev: dRevMonthly,
            yearly_rev: dRevYearly,
            total_rev: dRevMonthly + dRevYearly
        };
    });

    const fieldCounts: Record<string, number> = {};
    fieldJobs.forEach((j: any) => {
        const field = (j.configuration as any)?.fieldToEdit || 'unknown';
        fieldCounts[field] = (fieldCounts[field] || 0) + 1;
    });

    const topFieldsSelection = Object.entries(fieldCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([field, count]) => ({
            field,
            count,
            percentage: fieldJobs.length > 0 ? ((count / fieldJobs.length) * 100).toFixed(1) : 0
        }));

    const topActiveDomains = taskGroups
        .sort((a: any, b: any) => b._count._all - a._count._all)
        .slice(0, 50)
        .map((g: any) => g.shopDomain);

    const [activeJobsStats, activeShopDetails] = await Promise.all([
        prisma.priceJob.findMany({
            where: { shopDomain: { in: topActiveDomains }, ...(dateRange !== 'all' ? { createdAt: { gte: dateLimit } } : {}) },
            select: { shopDomain: true, status: true, createdAt: true }
        }),
        prisma.shop.findMany({
            where: { shop: { in: topActiveDomains } },
            select: { shop: true, shopName: true }
        })
    ]);

    const shopNameMap: Record<string, string> = {};
    activeShopDetails.forEach((s: any) => {
        shopNameMap[s.shop] = s.shopName || s.shop;
    });

    const storeActivity: Record<string, ActiveStore> = {};
    topActiveDomains.forEach((domain: any) => {
        storeActivity[domain] = {
            shop_name: shopNameMap[domain] || domain,
            domain: domain,
            total: 0,
            completed: 0,
            failed: 0,
            last_date: new Date(0).toISOString()
        };
    });

    activeJobsStats.forEach((j: any) => {
        if (!storeActivity[j.shopDomain]) return;
        storeActivity[j.shopDomain].total++;
        if (j.status === 'completed' || j.status === 'archived') storeActivity[j.shopDomain].completed++;
        if (j.status === 'failed') storeActivity[j.shopDomain].failed++;
        if (new Date(j.createdAt) > new Date(storeActivity[j.shopDomain].last_date)) {
            storeActivity[j.shopDomain].last_date = j.createdAt.toISOString();
        }
    });

    const activeStores = Object.values(storeActivity).sort((a, b) => b.total - a.total).slice(0, 10);
    const failedStores = Object.values(storeActivity).filter(s => s.failed > 0).sort((a, b) => (b.failed / (b.total || 1)) - (a.failed / (a.total || 1))).slice(0, 10);

    const recentSessionMap = new Set((await prisma.session.findMany({ where: { shop: { in: recentShops.map((s: any) => s.shop) }, isOnline: false }, select: { shop: true } })).map((s: any) => s.shop));

    const processedRecentShops = recentShops.map((s: any) => ({
        ...s,
        isInstalled: recentSessionMap.has(s.shop) || !s.uninstalledAt
    }));

    return {
        stats: {
            totalInstalls, activeInstalls, uninstalls, proUsers, freeUsers,
            monthlySubs, yearlySubs, mrr, arr, totalRevenueEst,
            totalTasks, completedTasks, failedTasks, revertedTasks,
            successRate, churnRate,
            netRevenue, refundedRevenue, cancelledSubs, billingConversionRate
        },
        funnelSteps,
        topFields: topFieldsSelection,
        activeStores,
        failedStores,
        chartData,
        topPaying,
        recentActivity,
        recentShops: processedRecentShops
    };
};

export default function OwnerDashboard() {
    const { stats, funnelSteps, topFields, activeStores, failedStores, chartData, recentShops, topPaying, recentActivity } = useLoaderData<any>();
    const [searchParams, setSearchParams] = useSearchParams();
    const submit = useSubmit();
    const navigate = useNavigate();

    const dateRange = searchParams.get("dateRange") || "30d";
    const search = searchParams.get("q") || "";

    const [searchValue, setSearchValue] = useState(search);

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchValue !== search) {
                const params = new URLSearchParams(searchParams);
                if (searchValue) params.set("q", searchValue);
                else params.delete("q");
                submit(params);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchValue, search, searchParams, submit]);

    const handleDateChange = useCallback((value: string) => {
        const params = new URLSearchParams(searchParams);
        params.set("dateRange", value);
        submit(params);
    }, [searchParams, submit]);

    const summaryCards = [
        { label: "Total Installs", value: stats.totalInstalls, icon: PersonIcon, tone: "info" },
        { label: "Active Installs", value: stats.activeInstalls, icon: StoreIcon, tone: "success" },
        { label: "Uninstalls", value: stats.uninstalls, icon: PersonExitIcon, tone: "critical" },
        { label: "Pro Users", value: stats.proUsers, icon: StarFilledIcon, tone: "success" },
        { label: "Free Users", value: stats.freeUsers, icon: PersonIcon, tone: "subdued" },
        { label: "Monthly Subs", value: stats.monthlySubs, icon: CalendarIcon, tone: "info" },
        { label: "Yearly Subs", value: stats.yearlySubs, icon: CalendarIcon, tone: "info" },
        { label: "MRR", value: `$${stats.mrr.toFixed(0)}`, icon: CashDollarIcon, tone: "success", help: "Monthly Recurring Revenue" },
        { label: "ARR", value: `$${stats.arr.toFixed(0)}`, icon: CashDollarIcon, tone: "success", help: "Annual Recurring Revenue" },
        { label: "Revenue Est.", value: `$${stats.totalRevenueEst.toFixed(0)}`, icon: CashDollarIcon, tone: "success", help: "Rough total estimate" },
        { label: "Net Revenue", value: `$${stats.netRevenue.toFixed(0)}`, icon: CashDollarIcon, tone: "success", help: "Total Lifetime Paid (Est)" },
        { label: "Refunded Rev", value: `$${stats.refundedRevenue.toFixed(0)}`, icon: CashDollarIcon, tone: "subdued" },
        { label: "Cancelled Subs", value: stats.cancelledSubs, icon: PersonExitIcon, tone: "critical" },
        { label: "Billing Conv. Rate", value: `${stats.billingConversionRate.toFixed(1)}%`, icon: ChartLineIcon, tone: "success", help: "Opened Plans -> Paid" },
        { label: "Total Tasks", value: stats.totalTasks, icon: ProductAddIcon, tone: "info" },
        { label: "Success Rate", value: `${stats.successRate.toFixed(1)}%`, icon: CheckCircleIcon, tone: "success" },
        { label: "Churn Rate", value: `${stats.churnRate.toFixed(1)}%`, icon: ChartLineIcon, tone: stats.churnRate > 20 ? "critical" : "subdued" },
    ];

    return (
        <Page fullWidth>
            <BlockStack gap="600">
                {/* Premium Hero Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-40%', right: '-10%', width: '300px', height: '300px' }} />
                    <div className="glass-element" style={{ bottom: '-20%', left: '5%', width: '200px', height: '200px' }} />

                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', width: '100%' }}>
                        <BlockStack gap="200">
                            <Box maxWidth="600px">
                                <BlockStack gap="100">
                                    <Text as="h1" variant="heading2xl" fontWeight="bold">
                                        Owner Dashboard
                                    </Text>
                                    <Text as="p" variant="bodyLg">
                                        <span style={{ opacity: 0.9 }}>Comprehensive analytics and management for Bulkify: Smart Bulk Editor.</span>
                                    </Text>
                                </BlockStack>
                            </Box>
                        </BlockStack>

                        <InlineStack gap="300">
                            <Button size="large" onClick={() => navigate("/app/support-admin")}>
                                Support Admin
                            </Button>
                        </InlineStack>
                    </div>
                </div>

                {/* Filters */}
                <div className="stat-card-static">
                    <Box padding="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Box width="350px">
                                <TextField
                                    label="Search shops"
                                    labelHidden
                                    placeholder="Search by name or domain..."
                                    value={searchValue}
                                    onChange={(val) => setSearchValue(val)}
                                    prefix={<Icon source={SearchIcon} />}
                                    autoComplete="off"
                                    clearButton
                                    onClearButtonClick={() => setSearchValue("")}
                                />
                            </Box>
                            <Select
                                label="Date Range"
                                labelHidden
                                options={[
                                    { label: "Last 7 Days", value: "7d" },
                                    { label: "Last 30 Days", value: "30d" },
                                    { label: "Last 90 Days", value: "90d" },
                                    { label: "All Time", value: "all" },
                                ]}
                                value={dateRange}
                                onChange={handleDateChange}
                            />
                        </InlineStack>
                    </Box>
                </div>

                {/* Summary Grid */}
                <Grid>
                    {summaryCards.map((card, i) => (
                        <Grid.Cell key={i} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 2 }}>
                            <div className="stat-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <Box padding="400">
                                    <BlockStack gap="100">
                                        <InlineStack align="space-between">
                                            <Text variant="bodySm" tone="subdued" fontWeight="medium" as="p">{card.label}</Text>
                                            <Icon source={card.icon} tone={card.tone as any} />
                                        </InlineStack>
                                        <InlineStack gap="100" blockAlign="center">
                                            <Text variant="headingLg" as="p">{card.value}</Text>
                                            {card.help && (
                                                <Tooltip content={card.help}>
                                                    <Icon source={InfoIcon} tone="subdued" />
                                                </Tooltip>
                                            )}
                                        </InlineStack>
                                    </BlockStack>
                                </Box>
                            </div>
                        </Grid.Cell>
                    ))}
                </Grid>

                {/* Charts */}
                <Layout>
                    <Layout.Section>
                        <div className="stat-card-static">
                            <Box padding="400">
                                <Text variant="headingMd" as="h2">Installs & Tasks Activity</Text>
                            </Box>
                            <Divider />
                            <Box padding="400">
                                <div style={{ width: '100%', height: 350 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis
                                                dataKey="date"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#8c9196', fontSize: 12 }}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#8c9196', fontSize: 12 }}
                                            />
                                            <ChartTooltip
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                            />
                                            <Legend verticalAlign="top" align="right" iconType="circle" height={36} />
                                            <Line
                                                type="monotone"
                                                dataKey="installs"
                                                stroke="var(--p-color-bg-fill-success)"
                                                strokeWidth={3}
                                                dot={false}
                                                activeDot={{ r: 6 }}
                                                name="New Installs"
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="tasks"
                                                stroke="#9c6ade"
                                                strokeWidth={3}
                                                dot={false}
                                                activeDot={{ r: 6 }}
                                                name="Tasks Created"
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </Box>
                        </div>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                        <div className="stat-card-static">
                            <Box padding="400">
                                <Text variant="headingMd" as="h2">Revenue Growth</Text>
                            </Box>
                            <Divider />
                            <Box padding="400">
                                <div style={{ width: '100%', height: 350 }}>
                                    <ResponsiveContainer>
                                        <BarChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis
                                                dataKey="date"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#8c9196', fontSize: 12 }}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#8c9196', fontSize: 12 }}
                                            />
                                            <ChartTooltip
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                            />
                                            <Legend verticalAlign="top" align="right" iconType="rect" height={36} />
                                            <Bar dataKey="monthly_rev" stackId="a" fill="var(--p-color-bg-fill-success)" radius={[0, 0, 0, 0]} name="Monthly" />
                                            <Bar dataKey="yearly_rev" stackId="a" fill="#005bd3" radius={[4, 4, 0, 0]} name="Yearly" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </Box>
                        </div>
                    </Layout.Section>
                </Layout>

                {/* Funnel & Fields */}
                <Layout>
                    <Layout.Section>
                        <div className="stat-card-static">
                            <Box padding="400">
                                <Text variant="headingMd" as="h2">Conversion Funnel (Unique Shops)</Text>
                            </Box>
                            <Divider />
                            <Box padding="600">
                                <BlockStack gap="500">
                                    {funnelSteps.map((step: any, i: number) => {
                                        const conv = step.conv;
                                        const totalBase = funnelSteps[0].count;
                                        const width = totalBase > 0 ? (step.count / totalBase) * 100 : 0;

                                        return (
                                            <div key={i}>
                                                <InlineStack align="space-between">
                                                    <Text variant="bodyMd" fontWeight="semibold" as="p">{step.name}</Text>
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <Text variant="bodyMd" fontWeight="bold" as="p">{step.count}</Text>
                                                        {i > 0 && <Badge tone="info">{`${conv}% conv.`}</Badge>}
                                                    </InlineStack>
                                                </InlineStack>
                                                <Box padding="200">
                                                    <div style={{ height: '12px', background: '#f1f1f1', borderRadius: '6px', overflow: 'hidden' }}>
                                                        <div style={{
                                                            width: `${width}%`,
                                                            height: '100%',
                                                            background: 'linear-gradient(90deg, var(--p-color-bg-fill-success), #00a080)',
                                                            transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            borderRadius: '6px'
                                                        }} />
                                                    </div>
                                                </Box>
                                            </div>
                                        );
                                    })}
                                </BlockStack>
                            </Box>
                        </div>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                        <div className="stat-card-static" style={{ height: '100%', overflow: 'hidden' }}>
                            <Box padding="400">
                                <Text variant="headingMd" as="h2">Top Edited Fields</Text>
                            </Box>
                            <Divider />
                            <IndexTable
                                resourceName={{ singular: 'field', plural: 'fields' }}
                                itemCount={topFields.length}
                                headings={[{ title: 'Field' }, { title: 'Usage' }]}
                                selectable={false}
                            >
                                {topFields.map((f: any, i: number) => (
                                    <IndexTable.Row id={i.toString()} key={i} position={i}>
                                        <IndexTable.Cell>
                                            <Text variant="bodyMd" fontWeight="bold" as="span">{f.field.replace('_', ' ')}</Text>
                                        </IndexTable.Cell>
                                        <IndexTable.Cell>
                                            <InlineStack gap="200" align="end" blockAlign="center">
                                                <Text variant="bodyMd" as="span">{f.count}</Text>
                                                <Badge tone="info">{`${f.percentage}%`}</Badge>
                                            </InlineStack>
                                        </IndexTable.Cell>
                                    </IndexTable.Row>
                                ))}
                            </IndexTable>
                        </div>
                    </Layout.Section>
                </Layout>

                {/* Failed Tasks & Activity Feed */}
                <Layout>
                    <Layout.Section>
                        <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                            <Box padding="400">
                                <Text variant="headingMd" as="h2">Stores With Most Failed Tasks</Text>
                            </Box>
                            <Divider />
                            <IndexTable
                                resourceName={{ singular: 'store', plural: 'stores' }}
                                itemCount={failedStores.length}
                                headings={[
                                    { title: 'Store' },
                                    { title: 'Total Tasks' },
                                    { title: 'Failed' },
                                    { title: 'Failure %' },
                                    { title: 'Last Date' },
                                    { title: 'Action' }
                                ]}
                                selectable={false}
                            >
                                {failedStores.map((s: any, i: number) => {
                                    const failRate = s.total > 0 ? ((s.failed / s.total) * 100).toFixed(1) : 0;
                                    return (
                                        <IndexTable.Row id={i.toString()} key={i} position={i}>
                                            <IndexTable.Cell>
                                                <BlockStack gap="050">
                                                    <Text variant="bodyMd" fontWeight="bold" as="span">{s.shop_name}</Text>
                                                    <Text variant="bodySm" tone="subdued" as="p">{s.domain}</Text>
                                                </BlockStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>{s.total}</IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Badge tone="critical">{s.failed.toString()}</Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>{failRate}%</IndexTable.Cell>
                                            <IndexTable.Cell><Text variant="bodySm" tone="subdued" as="span">{new Date(s.last_date).toLocaleDateString()}</Text></IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Button variant="plain" onClick={() => navigate(`/app/support-admin/${s.domain}`)}>Support View</Button>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    );
                                })}
                            </IndexTable>
                        </div>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <div className="stat-card-static" style={{ height: '100%', overflow: 'hidden' }}>
                            <Box padding="400">
                                <Text variant="headingMd" as="h2">Activity Feed</Text>
                            </Box>
                            <Divider />
                            <Box padding="400">
                                <BlockStack gap="400">
                                    {recentActivity.map((event: any, i: number) => (
                                        <FeedItem key={i} event={event} />
                                    ))}
                                    {recentActivity.length === 0 && <Text tone="subdued" as="p">No recent activity.</Text>}
                                </BlockStack>
                            </Box>
                        </div>
                    </Layout.Section>
                </Layout>

                {/* Most Active Stores */}
                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                    <Box padding="400">
                        <Text variant="headingMd" as="h2">Most Active Stores (All Time)</Text>
                    </Box>
                    <Divider />
                    <IndexTable
                        resourceName={{ singular: 'store', plural: 'stores' }}
                        itemCount={activeStores.length}
                        headings={[
                            { title: 'Store' },
                            { title: 'Tasks' },
                            { title: 'Success' },
                            { title: 'Last Activity' },
                            { title: 'Action' }
                        ]}
                        selectable={false}
                    >
                        {activeStores.map((s: any, i: number) => (
                            <IndexTable.Row id={i.toString()} key={i} position={i}>
                                <IndexTable.Cell>
                                    <InlineStack gap="300" blockAlign="center">
                                        <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                                            <Icon source={StoreIcon} tone="subdued" />
                                        </Box>
                                        <BlockStack gap="050">
                                            <Text variant="bodyMd" fontWeight="bold" as="span">{s.shop_name}</Text>
                                            <Text variant="bodySm" tone="subdued" as="p">{s.domain}</Text>
                                        </BlockStack>
                                    </InlineStack>
                                </IndexTable.Cell>
                                <IndexTable.Cell>{s.total}</IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Badge tone={s.completed === s.total ? 'success' : 'attention'}>{`${s.completed}/${s.total}`}</Badge>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <InlineStack gap="100" blockAlign="center">
                                        <Icon source={CalendarIcon} tone="subdued" />
                                        <Text variant="bodySm" as="span">{new Date(s.last_date).toLocaleDateString()}</Text>
                                    </InlineStack>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Button variant="plain" onClick={() => navigate(`/app/support-admin/${s.domain}`)}>Support View</Button>
                                </IndexTable.Cell>
                            </IndexTable.Row>
                        ))}
                    </IndexTable>
                </div>

                {/* Top Paying & Newest Installations */}
                <ProjectSection
                    topPaying={topPaying}
                    recentShops={recentShops}
                    navigate={navigate}
                />
            </BlockStack>
        </Page>
    );
}

function ProjectSection({ topPaying, recentShops, navigate }: { topPaying: any[], recentShops: any[], navigate: any }) {
    return (
        <Layout>
            <Layout.Section>
                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                    <Box padding="400">
                        <Text variant="headingMd" as="h2">Top Paying Customers (Lifetime Paid)</Text>
                    </Box>
                    <Divider />
                    <IndexTable
                        resourceName={{ singular: 'shop', plural: 'shops' }}
                        itemCount={topPaying?.length || 0}
                        headings={[
                            { title: 'Store' },
                            { title: 'Plan' },
                            { title: 'Lifetime Paid' },
                            { title: 'Last Payment' },
                            { title: 'Action' }
                        ]}
                        selectable={false}
                    >
                        {topPaying?.map((s: any, i: number) => (
                            <IndexTable.Row id={s.shop} key={i} position={i}>
                                <IndexTable.Cell>
                                    <InlineStack gap="300" blockAlign="center">
                                        <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                                            <Icon source={StarFilledIcon} tone="success" />
                                        </Box>
                                        <BlockStack gap="050">
                                            <Text variant="bodyMd" fontWeight="bold" as="span">{s.shopName}</Text>
                                            <Text variant="bodySm" tone="subdued" as="p">{s.shop}</Text>
                                        </BlockStack>
                                    </InlineStack>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Badge tone="success">{`${s.billingInterval} ${s.plan.replace('PRO_', '')}`}</Badge>
                                </IndexTable.Cell>
                                <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">${Number(s.totalSpent || 0)}</Text></IndexTable.Cell>
                                <IndexTable.Cell><Text variant="bodySm" tone="subdued" as="span">{s.lastPaymentDate ? new Date(s.lastPaymentDate).toLocaleDateString() : 'N/A'}</Text></IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Button variant="plain" onClick={() => navigate(`/app/support-admin/${s.shop}`)}>View</Button>
                                </IndexTable.Cell>
                            </IndexTable.Row>
                        ))}
                    </IndexTable>
                </div>
            </Layout.Section>

            <Layout.Section>
                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                    <Box padding="400">
                        <Text variant="headingMd" as="h2">Newest Installations</Text>
                    </Box>
                    <Divider />
                    <IndexTable
                        resourceName={{ singular: 'shop', plural: 'shops' }}
                        itemCount={recentShops.length}
                        headings={[
                            { title: 'Shop' },
                            { title: 'Plan' },
                            { title: 'Price' },
                            { title: 'Status' },
                            { title: 'Date' },
                            { title: 'Action' }
                        ]}
                        selectable={false}
                    >
                        {recentShops.map((shop: any, i: number) => (
                            <IndexTable.Row id={shop.shop || i.toString()} key={i} position={i}>
                                <IndexTable.Cell>
                                    <BlockStack gap="050">
                                        <Text variant="bodyMd" fontWeight="bold" as="span">{shop.shopName || 'N/A'}</Text>
                                        <Text variant="bodySm" tone="subdued" as="p">{shop.shop}</Text>
                                    </BlockStack>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Badge tone={shop.plan === 'PRO' ? 'success' : 'attention'}>{shop.plan}</Badge>
                                </IndexTable.Cell>
                                <IndexTable.Cell>${Number(shop.planPrice) || 0}</IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Badge tone={shop.isInstalled ? 'success' : 'critical'}>
                                        {shop.isInstalled ? 'Installed' : 'Uninstalled'}
                                    </Badge>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <InlineStack gap="100" blockAlign="center">
                                        <Icon source={CalendarIcon} tone="subdued" />
                                        <Text variant="bodySm" as="span">{new Date(shop.createdAt).toLocaleDateString()}</Text>
                                    </InlineStack>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Button variant="plain" icon={ExternalIcon} onClick={() => navigate(`/app/support-admin/${shop.shop}`)} />
                                </IndexTable.Cell>
                            </IndexTable.Row>
                        ))}
                    </IndexTable>
                </div>
            </Layout.Section>
        </Layout>
    );
}

function FeedItem({ event }: { event: any }) {
    let tone = 'info';
    let icon = CalendarIcon;

    if (event.eventName === 'install') { tone = 'success'; icon = PersonIcon; }
    if (event.eventName === 'uninstall') { tone = 'critical'; icon = PersonExitIcon; }
    if (event.eventName === 'billing_success') { tone = 'success'; icon = CashDollarIcon; }
    if (event.eventName === 'task_failed') { tone = 'critical'; icon = InfoIcon; }
    if (event.eventName === 'clicked_upgrade') { tone = 'attention'; icon = StarFilledIcon; }

    return (
        <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
                <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                    <Icon source={icon} tone={tone as any} />
                </Box>
                <BlockStack gap="050">
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{event.eventName.replace(/_/g, ' ')}</Text>
                    <Text variant="bodySm" tone="subdued" as="span">{event.shop?.shopName || event.shopDomain}</Text>
                </BlockStack>
            </InlineStack>
            <Text variant="bodySm" tone="subdued" as="span">{new Date(event.createdAt).toLocaleDateString()} {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        </InlineStack>
    );
}
