import { redirect, useLoaderData, useSearchParams, useSubmit, useNavigate } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    TextField,
    IndexTable,
    Badge,
    InlineStack,
    Box,
    Icon,
    Button,
    Pagination,
    Divider
} from "@shopify/polaris";
import { SearchIcon, ChevronLeftIcon, StoreIcon, MagicIcon, CalendarIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ADMIN_ALLOWLIST } from "../constants";

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    if (!ADMIN_ALLOWLIST.includes(session.shop)) {
        return redirect("/app");
    }

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = 20;

    const where = search ? {
        OR: [
            { shop: { contains: search, mode: 'insensitive' } },
            { shopName: { contains: search, mode: 'insensitive' } }
        ]
    } : {};

    const [dbShops, count] = await Promise.all([
        prisma.shop.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        }),
        prisma.shop.count({ where })
    ]);

    // Check for active sessions to determine installation status
    const shopDomains = dbShops.map(s => s.shop);
    const activeSessions = await prisma.session.findMany({
        where: {
            shop: { in: shopDomains },
            isOnline: false // offline sessions persist across restarts
        },
        select: {
            shop: true,
            expires: true
        }
    });

    const sessionMap = new Map(
        activeSessions.map(s => [s.shop, s])
    );

    const shops = (dbShops || []).map((s) => {
        const hasSession = sessionMap.has(s.shop);
        // A shop is installed if it has an active session OR uninstalledAt is null
        const isInstalled = hasSession || !s.uninstalledAt;

        return {
            ...s,
            isInstalled,
            hasActiveSession: hasSession,
            installedAt: s.createdAt,
            uninstalledAt: s.uninstalledAt,
            lastSeenAt: s.updatedAt,
            planPrice: s.planPrice ? Number(s.planPrice) : 0,
            billingPrice: s.billingPrice ? Number(s.billingPrice) : 0,
            discountAmount: s.discountAmount ? Number(s.discountAmount) : 0
        };
    });

    return {
        shops,
        total: count || 0,
        page,
        pageSize
    };
};

export default function SupportAdminIndex() {
    const { shops, total, page, pageSize } = useLoaderData();
    const [searchParams, setSearchParams] = useSearchParams();
    const submit = useSubmit();
    const navigate = useNavigate();

    const [searchValue, setSearchValue] = useState(searchParams.get("search") || "");

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchValue !== (searchParams.get("search") || "")) {
                const params = new URLSearchParams(searchParams);
                if (searchValue) params.set("search", searchValue);
                else params.delete("search");
                params.set("page", "1");
                submit(params);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [searchValue, searchParams, submit]);

    const handleSearch = useCallback((value) => {
        setSearchValue(value);
    }, []);

    return (
        <Page fullWidth>
            <BlockStack gap="600">
                {/* Premium Hero Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-30%', right: '-5%', width: '250px', height: '250px' }} />
                    <div className="glass-element" style={{ bottom: '-10%', left: '10%', width: '180px', height: '180px' }} />

                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <BlockStack gap="200">
                            <InlineStack gap="200" align="center">
                                <Box
                                    onClick={() => navigate("/app/owner-dashboard")}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8 }}
                                >
                                    <Icon source={ChevronLeftIcon} tone="inherit" />
                                    <Text as="span" variant="bodyMd" tone="inherit">Back to Dashboard</Text>
                                </Box>
                            </InlineStack>
                            <Box maxWidth="600px">
                                <BlockStack gap="100">
                                    <Text as="h1" variant="heading2xl" fontWeight="bold">
                                        Support Admin
                                    </Text>
                                    <Text as="p" variant="bodyLg">
                                        <span style={{ opacity: 0.9 }}>Search and manage Bulkify store installations across the platform.</span>
                                    </Text>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                    </div>
                </div>

                <Layout>
                    <Layout.Section>
                        <BlockStack gap="500">
                            <Card padding="500">
                                <BlockStack gap="400">
                                    <TextField
                                        label="Search Stores"
                                        labelHidden
                                        placeholder="Search by shop name or domain..."
                                        value={searchValue}
                                        onChange={handleSearch}
                                        prefix={<Icon source={SearchIcon} />}
                                        autoComplete="off"
                                        clearButton
                                        onClearButtonClick={() => handleSearch("")}
                                    />
                                </BlockStack>
                            </Card>

                            <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                <Box padding="400">
                                    <InlineStack align="space-between">
                                        <Text variant="headingMd" as="h2">Store Directory</Text>
                                        <Badge tone="info">{total} Stores Total</Badge>
                                    </InlineStack>
                                </Box>
                                <Divider />
                                <IndexTable
                                    resourceName={{ singular: 'shop', plural: 'shops' }}
                                    itemCount={shops.length}
                                    headings={[
                                        { title: 'Store' },
                                        { title: 'Plan' },
                                        { title: 'Billing' },
                                        { title: 'Installed' },
                                        { title: 'Status' },
                                        { title: 'Action' }
                                    ]}
                                    selectable={false}
                                >
                                    {shops.map((s, i) => (
                                        <IndexTable.Row id={s.shop} key={s.shop} position={i}>
                                            <IndexTable.Cell>
                                                <InlineStack gap="300" blockAlign="center">
                                                    <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                                                        <Icon source={StoreIcon} tone="subdued" />
                                                    </Box>
                                                    <BlockStack gap="050">
                                                        <Text variant="bodyMd" fontWeight="bold" as="span">{s.shopName || 'N/A'}</Text>
                                                        <Text variant="bodySm" tone="subdued" as="p">{s.shop}</Text>
                                                    </BlockStack>
                                                </InlineStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Badge tone={s.plan === 'PRO' ? 'success' : 'info'}>{s.plan}</Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <BlockStack gap="050">
                                                    <Text variant="bodySm" fontWeight="medium">
                                                        {(!s.isInstalled && s.billingStatus === 'ACTIVE') ? 'Cancelled' : s.billingStatus}
                                                    </Text>
                                                    <Text variant="bodyXs" tone="subdued">{s.billingInterval} - ${Number(s.planPrice) || 0}</Text>
                                                </BlockStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <BlockStack gap="050">
                                                    <InlineStack gap="100" align="start" blockAlign="center">
                                                        <Icon source={CalendarIcon} tone="subdued" />
                                                        <Text variant="bodySm" as="span">{new Date(s.installedAt).toLocaleDateString()}</Text>
                                                    </InlineStack>
                                                    <Text variant="bodyXs" tone="subdued">Last seen: {new Date(s.lastSeenAt).toLocaleDateString()}</Text>
                                                </BlockStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Badge tone={s.isInstalled ? 'success' : 'critical'}>
                                                    {s.isInstalled ? 'Installed' : 'Uninstalled'}
                                                </Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Button variant="plain" onClick={() => navigate(`/app/support-admin/${s.shop}`)}>Manage</Button>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    ))}
                                    {shops.length === 0 && (
                                        <IndexTable.Row id="empty" position={0}>
                                            <IndexTable.Cell colSpan={6}>
                                                <Box padding="800" textAlign="center">
                                                    <Text tone="subdued" as="p">No stores found matching your search.</Text>
                                                </Box>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    )}
                                </IndexTable>
                                <Divider />
                                <Box padding="400">
                                    <InlineStack align="center">
                                        <Pagination
                                            hasPrevious={page > 1}
                                            onPrevious={() => {
                                                const params = new URLSearchParams(searchParams);
                                                params.set("page", (page - 1).toString());
                                                submit(params);
                                            }}
                                            hasNext={total > page * pageSize}
                                            onNext={() => {
                                                const params = new URLSearchParams(searchParams);
                                                params.set("page", (page + 1).toString());
                                                submit(params);
                                            }}
                                        />
                                    </InlineStack>
                                </Box>
                            </div>
                        </BlockStack>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
