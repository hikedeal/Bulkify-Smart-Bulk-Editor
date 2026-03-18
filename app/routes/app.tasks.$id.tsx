import {
    Page, Layout, Card, BlockStack, Text, Badge, InlineStack, InlineGrid, Button, Box, Divider,
    ProgressBar, Banner, Link, TextField, Icon, IndexTable, Modal, SkeletonBodyText, SkeletonDisplayText, Pagination, Select, Thumbnail
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { EditIcon, SearchIcon, ExportIcon, ImportIcon, ArchiveIcon, ChevronLeftIcon, NoteIcon, ImageIcon, PlayIcon, UndoIcon } from "@shopify/polaris-icons";
import { runJob, revertJob, processPendingJobs } from "../services/bulk-update.server";
import { getTaskDescriptionList, getAppliesToText } from "../utils/task-descriptions";
import { sendTaskScheduledEmail, sendRevertScheduledEmail } from "../services/email.server";
import { ADMIN_ALLOWLIST } from "../constants";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const { id } = params;

    const isAdmin = ADMIN_ALLOWLIST.includes(session.shop);

    const task = await prisma.priceJob.findUnique({
        where: { jobId: id as string }
    });

    if (!task || (!isAdmin && task.shopDomain !== session.shop)) {
        throw new Response("Task Not Found", { status: 404 });
    }

    let products: any[] = (task.previewJson as any) || [];
    let shopCurrency = "$";

    const response = await admin.graphql(`
        query getTaskContext {
            shop {
                currencyCode
            }
            markets(first: 50) {
                nodes {
                    id
                    name
                    handle

                }
            }
        }
    `);
    const responseJson = await response.json() as any;
    const shopData = responseJson.data?.shop;
    const markets = responseJson.data?.markets?.nodes || [];

    const currencyCode = shopData?.currencyCode || "USD";
    const currencySymbols: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
    shopCurrency = currencySymbols[currencyCode] || currencyCode;

    return { task, products, shopCurrency, markets, currencyCode };
};

export const action = async ({ request, params }: any) => {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;
    const { id } = params;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "process-task") {
        const task = await prisma.priceJob.findUnique({
            where: { jobId: id, shopDomain: shop }
        });
        if (task) {
            runJob(task).catch(console.error);
            return { success: true };
        }
    }

    if (intent === "revert-task") {
        const task = await prisma.priceJob.findUnique({
            where: { jobId: id, shopDomain: shop }
        });
        if (task) {
            await prisma.priceJob.update({
                where: { jobId: id },
                data: {
                    status: "running",
                    revertStatus: "revert_pending"
                }
            });
            processPendingJobs().catch(console.error);
            return { success: true };
        }
    }

    if (intent === "exec-revert") {
        const task = await prisma.priceJob.findUnique({
            where: { jobId: id, shopDomain: shop }
        });
        if (task) {
            await prisma.priceJob.update({
                where: { jobId: id },
                data: {
                    status: "running",
                    revertStatus: "revert_pending"
                }
            });
            processPendingJobs().catch(console.error);
            return { success: true };
        }
    }

    if (intent === "start-manual-task") {
        const task = await prisma.priceJob.findUnique({
            where: { jobId: id, shopDomain: shop }
        });
        if (task) {
            await prisma.priceJob.update({
                where: { jobId: id },
                data: {
                    status: "scheduled",
                    startTime: new Date()
                }
            });
            runJob({ ...task, status: "scheduled", startTime: new Date() }).catch(console.error);
            return { success: true };
        }
    }

    if (intent === "schedule-revert") {
        const endTimeStr = formData.get("end_time") as string;
        if (endTimeStr) {
            const endTime = new Date(endTimeStr);
            await prisma.priceJob.update({
                where: { jobId: id, shopDomain: shop },
                data: {
                    endTime: endTime,
                    revertStatus: "scheduled"
                }
            });

            // --- EMAIL NOTIFICATION ---
            try {
                const [settings, task, shopRes] = await Promise.all([
                    prisma.shopSettings.findUnique({
                        where: { shopDomain: shop },
                        select: { contactEmail: true, shopName: true }
                    }),
                    prisma.priceJob.findUnique({
                        where: { jobId: id },
                        select: { name: true, configuration: true }
                    }),
                    admin.graphql(`
                        query getShopCurrency {
                            shop { currencyCode }
                            markets(first: 50) {
                                nodes {
                                    handle

                                }
                            }
                        }
                    `)
                ]);

                let emailCurrency = "$";
                try {
                    const shopJson = await shopRes.json() as any;
                    const currencyCode = shopJson.data?.shop?.currencyCode || "USD";
                    const markets = shopJson.data?.markets?.nodes || [];
                    const config = (task?.configuration as any) || {};

                    if (config.selectedMarkets?.length > 0) {
                        const mObj = markets.find((m: any) => m.handle === config.selectedMarkets[0]);
                        const mCurr = currencyCode || currencyCode;
                        const icons: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
                        emailCurrency = icons[mCurr] || mCurr;
                    } else {
                        const icons: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
                        emailCurrency = icons[currencyCode] || "$";
                    }
                } catch (e) {
                    console.error("Error fetching currency for email:", e);
                }

                if (settings?.contactEmail && task) {
                    const descriptions = getTaskDescriptionList(task.configuration, emailCurrency);
                    await sendRevertScheduledEmail({
                        taskName: task.name,
                        taskId: id,
                        scheduledAt: endTime.toLocaleString(),
                        shopName: settings.shopName || shop,
                        shopDomain: shop,
                        toEmail: settings.contactEmail,
                        description: descriptions.join(" • ")
                    });
                }
            } catch (emailErr) {
                console.error("Failed to send revert schedule notification:", emailErr);
            }

            return { success: true };
        }
    }

    if (intent === "cancel-scheduled-revert") {
        await prisma.priceJob.update({
            where: { jobId: id, shopDomain: shop },
            data: {
                endTime: null,
                revertStatus: null
            }
        });
        return { success: true };
    }

    if (intent === "run-again") {
        const task = await prisma.priceJob.findUnique({
            where: { jobId: id, shopDomain: shop }
        });
        if (task) {
            await prisma.priceJob.update({
                where: { jobId: id, shopDomain: shop },
                data: {
                    status: "scheduled",
                    revertStatus: null,
                    revertedAt: null,
                    processedProducts: 0,
                    error: null,
                    startTime: new Date()
                }
            });

            /* 
               Immediate runs from the task details don't need a "Scheduled" email 
               as the task begins processing right away.
            */

            processPendingJobs().catch(console.error);

            return { success: true };
        }
    }

    if (intent === "save-note") {
        const note = formData.get("note") as string;

        // Fetch current task to preserve BULK_QUERY_ID if it exists, as it's used for polling
        const currentTask = await prisma.priceJob.findUnique({
            where: { jobId: id, shopDomain: shop },
            select: { note: true }
        });

        let finalNote = note;
        if (currentTask?.note) {
            const matches = currentTask.note.match(/BULK_(QUERY|MUTATION)_ID:gid:\/\/shopify\/BulkOperation\/\d+/g);
            if (matches) {
                const metadata = matches.join('\n\n');
                finalNote = note ? `${note.trim()}\n\n${metadata}` : metadata;
            }
        }

        await prisma.priceJob.update({
            where: { jobId: id, shopDomain: shop },
            data: { note: finalNote }
        });
        return { success: true };
    }

    if (intent === "archive-task") {
        await prisma.priceJob.update({
            where: { jobId: id, shopDomain: shop },
            data: { status: "archived" }
        });
        return { success: true };
    }

    return { success: false };
};

const cleanNote = (note: string | null) => {
    if (!note) return "";
    return note.replace(/BULK_(QUERY|MUTATION)_ID:gid:\/\/shopify\/BulkOperation\/\d+/g, '').trim();
};

export default function TaskDetail() {
    const { task, products, shopCurrency, markets, currencyCode } = useLoaderData<typeof loader>();

    const getCurrencySymbol = useCallback((mHandle?: string) => {
        const icons: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
        if (!mHandle || mHandle === 'base') return shopCurrency;

        const mObj = markets.find((m: any) => m.handle === mHandle);
        const mCurr = currencyCode || currencyCode;
        return icons[mCurr] || mCurr;
    }, [markets, shopCurrency, currencyCode]);

    const navigate = useNavigate();
    const fetcher = useFetcher();
    const revalidator = useRevalidator();
    const [isRevertModalOpen, setIsRevertModalOpen] = useState(false);
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [currentNote, setCurrentNote] = useState(cleanNote(task.note));
    const [searchQuery, setSearchQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    const isTagTask = (task.configuration as any)?.fieldToEdit === 'tags';

    let filteredProducts = products.filter((p: any) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.variants?.some((v: any) => v.sku?.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Deduplicate products by ID for tags/status/etc tasks to show a clean product-level history
    if (isTagTask) {
        const seen = new Set();
        filteredProducts = filteredProducts.filter((p: any) => {
            const productId = p.id || p.title;
            if (seen.has(productId)) return false;
            seen.add(productId);
            return true;
        });
    }

    const totalItems = filteredProducts.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const currentProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const handleNextPage = () => setCurrentPage((p) => Math.min(p + 1, totalPages));
    const handlePrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));

    // --- MARKET SELECTOR LOGIC ---
    const config = task.configuration || {};
    const [previewScope, setPreviewScope] = useState<string>(() => {
        // Default to 'base' if allowed, otherwise first market
        if (config.applyToBasePrice !== false) return 'base';
        return config.selectedMarkets?.[0] || 'base';
    });

    const marketOptions = [
        ...(config.applyToBasePrice !== false ? [{ label: "Base price", value: "base" }] : []),
        ...(config.selectedMarkets?.map((m: string) => {
            const mObj = markets.find((mk: any) => mk.handle === m);
            return { label: mObj?.name || m, value: m };
        }) || [])
    ];

    const getPreviewCurrency = (scope: string) => {
        if (scope === 'base') return shopCurrency;
        const mObj = markets.find((m: any) => m.handle === scope);
        const mCurr = currencyCode || currencyCode;
        const icons: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
        return icons[mCurr] || mCurr;
    };

    const currentPreviewCurrency = getPreviewCurrency(previewScope);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    const handleExport = () => {
        if (!products.length) return;
        const headers = ["Product", "Variant ID", "Original Price", "Updated Price", "Compare At", "Updated Compare At"];
        const csvContent = [
            headers.join(","),
            ...products.map((p: any) => {
                const original = task.revertStatus === 'reverted' ? p.updated : p.original;
                const updated = task.revertStatus === 'reverted' ? p.original : p.updated;
                return `"${p.title.replace(/"/g, '""')}","", "${original}", "${updated}", "${p.original_compare || ""}", "${p.updated_compare || ""}"`
            })
        ].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `task_${task.jobId}_export.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleArchive = () => {
        const formData = new FormData();
        formData.append("intent", "archive-task");
        fetcher.submit(formData, { method: "post" });
    };
    const [isRunAgainModalOpen, setIsRunAgainModalOpen] = useState(false);
    const [scheduleDate, setScheduleDate] = useState("");
    const [scheduleTime, setScheduleTime] = useState("");

    useEffect(() => {
        const isPastOrNow = !task.startTime || new Date(task.startTime) <= new Date();
        if (fetcher.state === 'idle') {
            if (task.status === 'scheduled' && isPastOrNow) {
                const formData = new FormData();
                formData.append("intent", "process-task");
                fetcher.submit(formData, { method: "post" });
            } else if (task.revertStatus === 'revert_pending') {
                const formData = new FormData();
                formData.append("intent", "exec-revert");
                fetcher.submit(formData, { method: "post" });
            }
        }
    }, [task.status, task.revertStatus, fetcher.state]);

    useEffect(() => {
        const activeStates = ['creating', 'calculating', 'running', 'processing'];
        const isReverting = task.revertStatus === 'reverting' || task.revertStatus === 'revert_pending';
        // Auto-refresh if scheduled and fast approaching or past
        const isScheduledSoon = task.status === 'scheduled' && task.startTime && new Date(task.startTime).getTime() <= (new Date().getTime() + 60000); // within 1 min or past

        if (activeStates.includes(task.status) || isReverting || isScheduledSoon) {
            const interval = setInterval(() => { revalidator.revalidate(); }, 2000);
            return () => clearInterval(interval);
        }
    }, [task.status, task.revertStatus, task.startTime]);

    const handleRevert = () => {
        const formData = new FormData();
        formData.append("intent", "revert-task");
        fetcher.submit(formData, { method: "post" });
        setIsRevertModalOpen(false);
    };

    const handleRunAgain = () => {
        const formData = new FormData();
        formData.append("intent", "run-again");
        fetcher.submit(formData, { method: "post" });
        setIsRunAgainModalOpen(false);
    };

    const handleScheduleRevert = () => {
        if (!scheduleDate || !scheduleTime) {
            alert("Please select both date and time");
            return;
        }
        const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
        if (scheduledDateTime <= new Date()) {
            alert("Scheduled time must be in the future");
            return;
        }
        const formData = new FormData();
        formData.append("intent", "schedule-revert");
        formData.append("end_time", scheduledDateTime.toISOString());
        fetcher.submit(formData, { method: "post" });
        setIsScheduleModalOpen(false);
        setScheduleDate("");
        setScheduleTime("");
    };

    const handleCancelScheduledRevert = () => {
        const formData = new FormData();
        formData.append("intent", "cancel-scheduled-revert");
        fetcher.submit(formData, { method: "post" });
    };

    const handleSaveNote = () => {
        const formData = new FormData();
        formData.append("intent", "save-note");
        formData.append("note", currentNote);
        fetcher.submit(formData, { method: "post" });
        setIsNoteModalOpen(false);
    };

    const handleStartManualTask = () => {
        const formData = new FormData();
        formData.append("intent", "start-manual-task");
        fetcher.submit(formData, { method: "post" });
    };

    const shortId = parseInt((task.jobId || "").replace(/-/g, '').substring(0, 8), 16) % 100000;
    const displayId = shortId.toString().padStart(5, '0');
    const currentStatus = task.status;
    const isScheduledProcessing = currentStatus === 'scheduled' && task.startTime && new Date(task.startTime) <= new Date();
    const isProcessing = ['creating', 'calculating', 'running'].includes(currentStatus) || isScheduledProcessing;
    const processed = task.processedProducts || 0;
    const total = task.totalProducts || 0;
    const progress = isProcessing ? 0 : (task.status === 'completed' || task.status === 'reverted' ? 100 : Math.round((processed / (total || 1)) * 100));

    const statusTones: Record<string, string> = {
        completed: "success",
        running: "info",
        calculating: "info",
        creating: "info",
        failed: "critical",
        scheduled: "info",
        reverted: "info",
        pending: "attention",
    };
    // const isScheduledProcessing = currentStatus === 'scheduled' && task.startTime && new Date(task.startTime) <= new Date(); // Already defined above
    const displayStatus = currentStatus === 'pending' ? 'MANUAL START' : (isScheduledProcessing ? 'RUNNING' : currentStatus.toUpperCase());

    const statusTone = (isScheduledProcessing ? "info" : (statusTones[currentStatus] || "info")) as any;

    const formatDate = (dateString: any) => {
        if (!dateString) return "-";
        return new Date(dateString).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
        });
    };



    const targetCurrencyForDescription = getCurrencySymbol(task.configuration?.selectedMarkets?.[0]);
    const descriptions = getTaskDescriptionList(task.configuration || {}, targetCurrencyForDescription);

    return (
        <Page fullWidth>
            <BlockStack gap="600">
                {/* Custom Header Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-10%', right: '-5%', width: '200px', height: '200px' }} />
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                                <div
                                    onClick={() => navigate("/app/tasks")}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: 1, color: 'white' }}
                                >
                                    <Icon source={ChevronLeftIcon} tone="inherit" />
                                    <Text as="span" variant="bodyMd" tone="inherit">Back to tasks</Text>
                                </div>
                            </InlineStack>
                            <BlockStack gap="100">
                                <Text as="h1" variant="heading2xl" fontWeight="bold">
                                    #{displayId} - {task.name || "Task Detail"}
                                </Text>
                                <InlineStack gap="200" blockAlign="center">
                                    <Badge tone={statusTone}>{displayStatus}</Badge>
                                    <Text as="p" variant="bodyMd">
                                        <span style={{ opacity: 1, color: 'white' }}>Created on {formatDate(task.createdAt)}</span>
                                    </Text>
                                </InlineStack>
                            </BlockStack>
                        </BlockStack>

                        <InlineStack gap="300">
                            <Button
                                icon={ArchiveIcon}
                                disabled={task.status === 'archived' || fetcher.state !== 'idle'}
                                onClick={handleArchive}
                            >
                                {fetcher.state === 'submitting' ? 'Archiving...' : 'Archive'}
                            </Button>

                            {task.status === 'scheduled' && !isScheduledProcessing && (
                                <Button
                                    icon={EditIcon}
                                    onClick={() => navigate(`/app/tasks/new?edit=${task.jobId}`)}
                                >
                                    Edit Task
                                </Button>
                            )}

                            {(task.status === 'pending' || (task.status === 'scheduled' && !isScheduledProcessing)) && (
                                <Button
                                    variant="primary"
                                    icon={PlayIcon}
                                    onClick={handleStartManualTask}
                                    loading={fetcher.state !== 'idle'}
                                    disabled={fetcher.state !== 'idle'}
                                >
                                    Apply changes now
                                </Button>
                            )}

                            {task.revertStatus === 'reverted' ? (
                                <Button
                                    variant="primary"
                                    disabled={fetcher.state !== 'idle'}
                                    loading={fetcher.state !== 'idle' && fetcher.formData?.get("intent") === "run-again"}
                                    onClick={() => setIsRunAgainModalOpen(true)}
                                >
                                    Run Again
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    tone="critical"
                                    disabled={currentStatus !== 'completed' || fetcher.state !== 'idle' || task.revertStatus === 'reverting'}
                                    loading={fetcher.state !== 'idle' && fetcher.formData?.get("intent") === "revert-task"}
                                    onClick={() => setIsRevertModalOpen(true)}
                                >
                                    Revert Now
                                </Button>
                            )}
                        </InlineStack>
                    </div>
                </div>

                <BlockStack gap="500">
                    {task.error && (
                        <Banner tone="critical" title="Job Failed">
                            <p>{task.error}</p>
                        </Banner>
                    )}

                    {isProcessing && (
                        <Banner tone="info" title="Preparing Task">
                            <p>We are calculating the changes for your task. This may take a moment.</p>
                        </Banner>
                    )}

                    <Layout>
                        <Layout.Section>
                            <BlockStack gap="500">
                                {/* Editing Rules Card */}
                                <div className="stat-card-static">
                                    <Box padding="400">
                                        <BlockStack gap="300">
                                            <Text variant="headingMd" as="h2">Editing rules</Text>
                                            <BlockStack gap="200">
                                                <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
                                                    {descriptions.map((desc, i) => (
                                                        <li key={i}>
                                                            <Text as="span" variant="bodyMd">{desc}</Text>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </BlockStack>
                                        </BlockStack>
                                    </Box>
                                </div>

                                {/* Applies To Card */}
                                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                    <Box padding="400">
                                        <BlockStack gap="300">
                                            <Text variant="headingMd" as="h2">Applies to</Text>
                                            <Box paddingInlineStart="200">
                                                <BlockStack gap="200">
                                                    <Text as="p" variant="bodySm" fontWeight="bold">Product matching</Text>
                                                    <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
                                                        <li>
                                                            <Text as="span" variant="bodyMd">
                                                                {(() => {
                                                                    const config = task.configuration || {};
                                                                    const applyTo = config.applyToProducts || 'all';
                                                                    const count = task.totalProducts || 0;

                                                                    if (applyTo === 'all') return `All products (${count} products)`;
                                                                    if (applyTo === 'collections') return `${config.selectedCollections?.length || 0} collections selected`;
                                                                    if (applyTo === 'specific') return `${config.selectedProducts?.length || 0} products selected`;
                                                                    if (applyTo === 'conditions') return `${count} products matching conditions`;
                                                                    return `${count} products`;
                                                                })()}
                                                            </Text>
                                                        </li>
                                                    </ul>

                                                    <Text as="p" variant="bodySm" fontWeight="bold">Variant matching</Text>
                                                    <ul style={{ margin: 0, paddingLeft: "1.5rem", marginBottom: "8px" }}>
                                                        <li>
                                                            <Text as="span" variant="bodyMd">
                                                                {(() => {
                                                                    const config = task.configuration || {};
                                                                    const applyTo = config.applyToVariants || 'all';
                                                                    if (applyTo === 'all') return "All variants";
                                                                    return "Variants matching specific conditions";
                                                                })()}
                                                            </Text>
                                                        </li>
                                                    </ul>

                                                    {task.configuration?.applyToMarkets && task.configuration.selectedMarkets?.length > 0 && (
                                                        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--p-color-border-subdued)" }}>
                                                            <Text as="p" variant="bodySm" fontWeight="bold">Active Markets</Text>
                                                            <Box paddingBlockStart="200">
                                                                <BlockStack gap="200">
                                                                    {task.configuration.selectedMarkets.map((mHandle: string) => {
                                                                        const mObj = markets.find((m: any) => m.handle === mHandle);
                                                                        const mCurr = currencyCode || currencyCode;
                                                                        const symbol = getCurrencySymbol(mHandle);
                                                                        const isDifferent = mCurr !== currencyCode;

                                                                        return (
                                                                            <Box key={mHandle} padding="200" background="bg-surface-secondary" borderRadius="200">
                                                                                <InlineStack align="space-between" blockAlign="center">
                                                                                    <BlockStack gap="050">
                                                                                        <Text as="span" variant="bodySm" fontWeight="bold">{mObj?.name || mHandle}</Text>
                                                                                        {isDifferent && (
                                                                                            <Text as="span" variant="bodyXs" tone="subdued">Auto-converted from {currencyCode}</Text>
                                                                                        )}
                                                                                    </BlockStack>
                                                                                    <Badge tone={isDifferent ? "warning" : "info"} size="small">
                                                                                        {`${mCurr} (${symbol})`}
                                                                                    </Badge>
                                                                                </InlineStack>
                                                                            </Box>
                                                                        );
                                                                    })}
                                                                </BlockStack>
                                                            </Box>
                                                        </div>
                                                    )}
                                                </BlockStack>
                                            </Box>
                                        </BlockStack>
                                    </Box>
                                </div>

                                {/* Product Changes Card */}
                                {task.configuration?.fieldToEdit !== 'tags' && (
                                    <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                        <Box padding="400">
                                            <BlockStack gap="400">
                                                <InlineStack align="space-between" blockAlign="center">
                                                    <InlineStack gap="200" align="center">
                                                        <Text variant="headingMd" as="h2">
                                                            {task.revertStatus === 'reverted' ? "Reverted product changes" : "Product changes"}
                                                        </Text>
                                                        {products.length >= 100 && (
                                                            <Text variant="bodySm" tone="subdued" as="span">(Showing first 100 items)</Text>
                                                        )}
                                                    </InlineStack>
                                                    <InlineStack gap="200">
                                                        {marketOptions.length > 1 && (
                                                            <div style={{ width: '200px' }}>
                                                                <Select
                                                                    label="Market"
                                                                    labelInline
                                                                    options={marketOptions}
                                                                    onChange={setPreviewScope}
                                                                    value={previewScope}
                                                                />
                                                            </div>
                                                        )}
                                                        <Button icon={ExportIcon} onClick={handleExport} accessibilityLabel="Export" />
                                                    </InlineStack>
                                                </InlineStack>
                                                <TextField
                                                    label="Search"
                                                    labelHidden
                                                    prefix={<Icon source={SearchIcon} />}
                                                    placeholder="Search products by title or SKU"
                                                    value={searchQuery}
                                                    onChange={setSearchQuery}
                                                    autoComplete="off"
                                                />
                                            </BlockStack>
                                        </Box>
                                        <Divider />
                                        {isProcessing ? (
                                            <Box padding="400">
                                                <BlockStack gap="400">
                                                    <SkeletonDisplayText size="small" />
                                                    <SkeletonBodyText lines={5} />
                                                </BlockStack>
                                            </Box>
                                        ) : (
                                            (() => {
                                                const config = task.configuration || {};
                                                const fieldToEdit = config.fieldToEdit || 'price';
                                                const configCompareAtOption = config.compareAtPriceOption;
                                                const showPrice = fieldToEdit === 'price' || (fieldToEdit === 'compare_price' && config.priceOption === 'set');
                                                const showCompareAt = fieldToEdit === 'compare_price' || (fieldToEdit === 'price' && configCompareAtOption && configCompareAtOption !== 'none');
                                                const showCost = fieldToEdit === 'cost';
                                                const showPriceAsBase = showCost && ['set_to_price'].includes(config.editMethod);
                                                const showCompareAsBaseForCost = showCost && ['set_to_compare_at'].includes(config.editMethod);

                                                const headings: any[] = [{ title: "Product" }];
                                                if (showPriceAsBase) {
                                                    headings.push({ title: "Original price" });
                                                }
                                                if (showCompareAsBaseForCost) {
                                                    headings.push({ title: "Original compare at" });
                                                }
                                                if (showPrice) {
                                                    headings.push({ title: task.revertStatus === 'reverted' ? "Updated price" : "Original price" });
                                                    headings.push({ title: task.revertStatus === 'reverted' ? "Reverted to" : "Updated price" });
                                                }
                                                if (showCompareAt) {
                                                    headings.push({ title: task.revertStatus === 'reverted' ? "Updated compare at" : "Original compare at" });
                                                    headings.push({ title: task.revertStatus === 'reverted' ? "Reverted compare at" : "Updated compare at" });
                                                }
                                                if (showCost) {
                                                    headings.push({ title: task.revertStatus === 'reverted' ? "Updated cost" : "Original cost" });
                                                    headings.push({ title: task.revertStatus === 'reverted' ? "Reverted to" : "Updated cost" });
                                                }

                                                // Add dynamic tag columns for secondary tag actions in history
                                                // Remove secondary tag columns from main table (moved to sidebar)

                                                if (!showPrice && !showCompareAt && !showCost && fieldToEdit !== 'tags') {
                                                    if (fieldToEdit === 'requires_shipping') {
                                                        headings.push({ title: "Original Requires Shipping" });
                                                        headings.push({ title: "Updated Requires Shipping" });
                                                    } else if (fieldToEdit === 'taxable') {
                                                        headings.push({ title: "Original Taxable" });
                                                        headings.push({ title: "Updated Taxable" });
                                                    } else {
                                                        headings.push({ title: "Original Value" });
                                                        headings.push({ title: "Updated Value" });
                                                    }
                                                }
                                                return (
                                                    <BlockStack gap="400">
                                                        <IndexTable
                                                            resourceName={{ singular: "item", plural: "items" }}
                                                            itemCount={filteredProducts.filter((p: any) => {
                                                                if (fieldToEdit === 'tags') return false;
                                                                // Filter duplicates: If we are editing PRICE, ignore rows that ONLY have tag info but no price info
                                                                if (fieldToEdit === 'price') {
                                                                    if (p.isProductUpdate && p.original === undefined && p.updated === undefined && !p.original_price && !p.updated_price) {
                                                                        return false;
                                                                    }
                                                                }
                                                                return true;
                                                            }).length}
                                                            headings={headings as any}
                                                            selectable={false}
                                                        >
                                                            {currentProducts.length === 0 ? (
                                                                <IndexTable.Row id="empty" position={0}>
                                                                    <IndexTable.Cell><Text as="span" tone="subdued">No matching products found.</Text></IndexTable.Cell>
                                                                    {headings.slice(1).map((_, i) => <IndexTable.Cell key={i}></IndexTable.Cell>)}
                                                                </IndexTable.Row>
                                                            ) : (
                                                                filteredProducts
                                                                    .filter((p: any) => {
                                                                        if (fieldToEdit === 'tags') return false;
                                                                        if (['price', 'compare_price', 'cost', 'inventory'].includes(fieldToEdit)) {
                                                                            if (p.isProductUpdate) {
                                                                                return false;
                                                                            }
                                                                        }
                                                                        // For metafield, weight, requires_shipping, taxable - show product-level updates
                                                                        return true;
                                                                    })
                                                                    .map((item: any, index: number) => (
                                                                        <IndexTable.Row id={item.id || index.toString()} key={`${item.id}-${index}`} position={index}>
                                                                            <IndexTable.Cell>
                                                                                <InlineStack gap="300" blockAlign="center">
                                                                                    <Thumbnail
                                                                                        source={item.image || ImageIcon}
                                                                                        alt={item.title}
                                                                                        size="small"
                                                                                    />
                                                                                    <Text variant="bodyMd" fontWeight="bold" as="span">{item.title}</Text>
                                                                                </InlineStack>
                                                                            </IndexTable.Cell>

                                                                            {(() => {
                                                                                const targetCurrency = currentPreviewCurrency;

                                                                                return (
                                                                                    <>
                                                                                        {showPrice && (
                                                                                            <>
                                                                                                <IndexTable.Cell>
                                                                                                    <Text variant="bodyMd" tone="subdued" as="span">
                                                                                                        <span style={{ textDecoration: 'line-through' }}>
                                                                                                            {(() => {
                                                                                                                const val = task.revertStatus === 'reverted' ? (item.updated_price || item.updatedPrice) : (item.original_price || item.originalPrice);
                                                                                                                // Fallback: if editing price, the main "original/updated" fields hold the price values
                                                                                                                const fallback = (!val && fieldToEdit === 'price') ? (task.revertStatus === 'reverted' ? item.updated : item.original) : val;
                                                                                                                return (fallback !== undefined && fallback !== null) ? `${targetCurrency}${fallback}` : '-';
                                                                                                            })()}
                                                                                                        </span>
                                                                                                    </Text>
                                                                                                </IndexTable.Cell>
                                                                                                <IndexTable.Cell>
                                                                                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                                                                                        {(() => {
                                                                                                            const val = task.revertStatus === 'reverted' ? (item.original_price || item.originalPrice) : (item.updated_price || item.updatedPrice);
                                                                                                            const fallback = (!val && fieldToEdit === 'price') ? (task.revertStatus === 'reverted' ? item.original : item.updated) : val;
                                                                                                            return (fallback !== undefined && fallback !== null) ? `${targetCurrency}${fallback}` : '-';
                                                                                                        })()}
                                                                                                    </Text>
                                                                                                </IndexTable.Cell>
                                                                                            </>
                                                                                        )}

                                                                                        {showCompareAt && (
                                                                                            <>
                                                                                                <IndexTable.Cell>
                                                                                                    <Text variant="bodyMd" tone="subdued" as="span">
                                                                                                        <span style={{ textDecoration: 'line-through' }}>
                                                                                                            {(() => {
                                                                                                                const val = task.revertStatus === 'reverted' ? (item.updated_compare || item.updatedCompareAt) : (item.original_compare || item.originalCompareAt);
                                                                                                                // Fallback: if editing compare_price, the main "original/updated" fields hold these values
                                                                                                                const fallback = (!val && fieldToEdit === 'compare_price') ? (task.revertStatus === 'reverted' ? item.updated : item.original) : val;
                                                                                                                return (fallback !== undefined && fallback !== null) ? `${targetCurrency}${fallback}` : '-';
                                                                                                            })()}
                                                                                                        </span>
                                                                                                    </Text>
                                                                                                </IndexTable.Cell>
                                                                                                <IndexTable.Cell>
                                                                                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                                                                                        {(() => {
                                                                                                            const val = task.revertStatus === 'reverted' ? (item.original_compare || item.originalCompareAt) : (item.updated_compare || item.updatedCompareAt);
                                                                                                            const fallback = (!val && fieldToEdit === 'compare_price') ? (task.revertStatus === 'reverted' ? item.original : item.updated) : val;
                                                                                                            return (fallback !== undefined && fallback !== null) ? `${targetCurrency}${fallback}` : '-';
                                                                                                        })()}
                                                                                                    </Text>
                                                                                                </IndexTable.Cell>
                                                                                            </>
                                                                                        )}

                                                                                        {showCost && (
                                                                                            <>
                                                                                                {config.editMethod === 'set_to_price' && (
                                                                                                    <IndexTable.Cell>
                                                                                                        <Text variant="bodyMd" as="span">{item.original_price ? `${targetCurrency}${item.original_price}` : '-'}</Text>
                                                                                                    </IndexTable.Cell>
                                                                                                )}
                                                                                                {config.editMethod === 'set_to_compare_at' && (
                                                                                                    <IndexTable.Cell>
                                                                                                        <Text variant="bodyMd" tone="subdued" as="span">{item.original_compare ? `${targetCurrency}${item.original_compare}` : '-'}</Text>
                                                                                                    </IndexTable.Cell>
                                                                                                )}
                                                                                                <IndexTable.Cell>
                                                                                                    <Text variant="bodyMd" tone="subdued" as="span">
                                                                                                        <span style={{ textDecoration: !['set_to_price', 'set_to_compare_at', 'fixed'].includes(config.editMethod) ? 'line-through' : 'none' }}>
                                                                                                            {targetCurrency}{task.revertStatus === 'reverted' ? item.updated : item.original}
                                                                                                        </span>
                                                                                                    </Text>
                                                                                                </IndexTable.Cell>
                                                                                                <IndexTable.Cell>
                                                                                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                                                                                        {targetCurrency}{task.revertStatus === 'reverted' ? item.original : item.updated}
                                                                                                    </Text>
                                                                                                </IndexTable.Cell>
                                                                                            </>
                                                                                        )}
                                                                                    </>
                                                                                );
                                                                            })()}

                                                                            {/* Additional Tag Columns for Task History */}
                                                                            {/* Secondary Tag Columns REMOVED (Moved to Sidebar) */}

                                                                            {!showPrice && !showCompareAt && !showCost && (
                                                                                <>
                                                                                    <IndexTable.Cell>
                                                                                        {fieldToEdit === 'tags' ? (
                                                                                            <InlineStack gap="100">
                                                                                                {(task.revertStatus === 'reverted' ? item.updated : item.original).split(",").filter(Boolean).map((tag: string, i: number) => (
                                                                                                    <Badge key={i} tone="attention">{tag.trim()}</Badge>
                                                                                                ))}
                                                                                            </InlineStack>
                                                                                        ) : (
                                                                                            <Text variant="bodyMd" tone="subdued" as="span">
                                                                                                {task.revertStatus === 'reverted' ? item.updated : item.original}
                                                                                            </Text>
                                                                                        )}
                                                                                    </IndexTable.Cell>
                                                                                    <IndexTable.Cell>
                                                                                        {fieldToEdit === 'tags' ? (
                                                                                            <InlineStack gap="100">
                                                                                                {(task.revertStatus === 'reverted' ? item.original : item.updated).split(",").filter(Boolean).map((tag: string, i: number) => (
                                                                                                    <Badge key={i} tone="success">{tag.trim()}</Badge>
                                                                                                ))}
                                                                                            </InlineStack>
                                                                                        ) : (
                                                                                            <Text variant="bodyMd" fontWeight="bold" as="span">
                                                                                                {task.revertStatus === 'reverted' ? item.original : item.updated}
                                                                                            </Text>
                                                                                        )}
                                                                                    </IndexTable.Cell>
                                                                                </>
                                                                            )}
                                                                        </IndexTable.Row>
                                                                    ))
                                                            )}
                                                        </IndexTable>
                                                        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                                                            <Pagination
                                                                hasPrevious={currentPage > 1}
                                                                onPrevious={handlePrevPage}
                                                                hasNext={currentPage < totalPages}
                                                                onNext={handleNextPage}
                                                                label={`${currentPage} of ${totalPages}`}
                                                            />
                                                        </div>
                                                    </BlockStack>
                                                );
                                            })()
                                        )}
                                    </div>
                                )}
                            </BlockStack>
                        </Layout.Section>

                        <Layout.Section variant="oneThird">
                            <BlockStack gap="500">
                                {/* Task Status Card */}
                                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                    <Box padding="400">
                                        <BlockStack gap="300">
                                            {(() => {
                                                const showAsCompleted = task.status === 'completed' || task.status === 'reverted' || !!task.revertStatus;
                                                const displayProcessed = showAsCompleted ? total : processed;
                                                const displayTotal = total > 0 ? total : 1;
                                                const displayProgress = showAsCompleted ? 100 : progress;
                                                const displayStatusTone = showAsCompleted ? 'success' : statusTone;
                                                const displayStatusLabel = showAsCompleted ? 'COMPLETED' : currentStatus.toUpperCase();

                                                return (
                                                    <>
                                                        <InlineStack align="space-between">
                                                            <Text variant="headingMd" as="h2">Task status</Text>
                                                            <Badge tone={displayStatusTone}>{displayStatusLabel}</Badge>
                                                        </InlineStack>
                                                        <BlockStack gap="100">
                                                            <InlineStack align="space-between">
                                                                <Text variant="bodyMd" tone="subdued" as="span">
                                                                    {showAsCompleted ? 'Completed on' : (new Date(task.startTime) > new Date() ? 'Scheduled for' : 'Started on')}
                                                                </Text>
                                                                <Text variant="bodyMd" as="span">
                                                                    {showAsCompleted ? formatDate(task.completedAt || task.createdAt) : formatDate(task.startTime || task.createdAt)}
                                                                </Text>
                                                            </InlineStack>
                                                        </BlockStack>
                                                        <BlockStack gap="100">
                                                            <InlineStack align="space-between">
                                                                <Text variant="bodyMd" tone="subdued" as="span">Products changed</Text>
                                                                <Text variant="bodyMd" as="span">
                                                                    {displayProcessed}/{displayTotal}
                                                                </Text>
                                                            </InlineStack>
                                                            <ProgressBar progress={displayProgress} size="small" tone={showAsCompleted ? "success" : "primary"} />
                                                        </BlockStack>
                                                    </>
                                                );
                                            })()}
                                        </BlockStack>
                                    </Box>
                                </div>


                                {/* Revert Status Card */}
                                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                    <Box padding="400">
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between">
                                                <Text variant="headingMd" as="h2">Revert status</Text>
                                                <Badge tone={
                                                    task.revertStatus === 'reverted' ? 'success' :
                                                        task.revertStatus === 'scheduled' ? 'info' :
                                                            (task.revertStatus === 'reverting' || task.revertStatus === 'revert_pending') ? 'attention' :
                                                                undefined
                                                }>
                                                    {task.revertStatus ? task.revertStatus.replace('revert_pending', 'Reverting...').replace('_', ' ').charAt(0).toUpperCase() + task.revertStatus.replace('revert_pending', 'reverting...').replace('_', ' ').slice(1) : 'Not reverted'}
                                                </Badge>
                                            </InlineStack>

                                            <BlockStack gap="100">
                                                <InlineStack align="space-between">
                                                    <Text variant="bodyMd" tone="subdued" as="span">
                                                        {task.revertStatus === 'scheduled' ? 'Scheduled for' :
                                                            task.revertStatus === 'reverted' ? 'Reverted on' :
                                                                'Started on'}
                                                    </Text>
                                                    <Text variant="bodyMd" as="span">
                                                        {task.revertStatus === 'scheduled' ? formatDate(task.endTime) :
                                                            task.revertStatus === 'reverted' ? formatDate(task.revertedAt) :
                                                                (task.revertStatus === 'reverting' || task.revertStatus === 'revert_pending') ? formatDate(new Date().toISOString()) :
                                                                    '-'}
                                                    </Text>
                                                </InlineStack>
                                            </BlockStack>

                                            {(task.revertStatus === 'reverting' || task.revertStatus === 'reverted' || task.revertStatus === 'revert_pending') && (
                                                <BlockStack gap="100">
                                                    <InlineStack align="space-between">
                                                        <Text variant="bodyMd" tone="subdued" as="span">Revert progress</Text>
                                                        <Text variant="bodyMd" as="span">
                                                            {task.processedProducts || 0}/{Object.keys(task.originalData || {}).length}
                                                        </Text>
                                                    </InlineStack>
                                                    <ProgressBar
                                                        progress={((task.processedProducts || 0) / (Object.keys(task.originalData || {}).length || 1)) * 100}
                                                        size="small"
                                                        tone="critical"
                                                    />
                                                </BlockStack>
                                            )}

                                            {task.revertStatus === 'scheduled' && (
                                                <Button onClick={handleCancelScheduledRevert} tone="critical" size="slim">
                                                    Cancel scheduled revert
                                                </Button>
                                            )}
                                        </BlockStack>
                                    </Box>
                                </div>


                                {/* Revert Options Card */}
                                {!task.revert_status && currentStatus === 'completed' && (
                                    <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                        <Box padding="400">
                                            <BlockStack gap="200">
                                                <Text variant="headingMd" as="h2">Revert options</Text>
                                                <Button
                                                    onClick={() => setIsScheduleModalOpen(true)}
                                                    disabled={fetcher.state !== 'idle'}
                                                    fullWidth
                                                >
                                                    Schedule revert
                                                </Button>
                                            </BlockStack>
                                        </Box>
                                    </div>
                                )}

                                {/* Tags Manager Card */}
                                {(() => {
                                    const config = task.configuration || {};
                                    const isTagField = config.fieldToEdit === 'tags';
                                    const hasSecondaryTags = (config.addTags && config.tagsToAdd) || (config.removeTags && config.tagsToRemove);

                                    if (!isTagField && !hasSecondaryTags) return null;

                                    return (
                                        <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                            <Box padding="400">
                                                <BlockStack gap="300">
                                                    <Text variant="headingMd" as="h2">Tags manager</Text>
                                                    <BlockStack gap="200">
                                                        {isTagField ? (
                                                            <BlockStack gap="100">
                                                                <Text variant="bodySm" tone="subdued" as="p">
                                                                    {config.editMethod === 'add_tags' ? 'Adding tags' :
                                                                        config.editMethod === 'remove_tags' ? 'Removing tags' : 'Replacing tags'}
                                                                </Text>
                                                                <InlineStack gap="100">
                                                                    {(config.editValue || "").split(",").filter(Boolean).map((tag: string, i: number) => (
                                                                        <Badge key={i} tone={config.editMethod === 'remove_tags' ? "critical" : "success"}>{tag.trim()}</Badge>
                                                                    ))}
                                                                </InlineStack>
                                                            </BlockStack>
                                                        ) : (
                                                            <>
                                                                {config.addTags && config.tagsToAdd && (
                                                                    <BlockStack gap="100">
                                                                        <Text variant="bodySm" tone="subdued" as="p">Adding tags</Text>
                                                                        <InlineStack gap="100">
                                                                            {(config.tagsToAdd as string).split(",").filter(Boolean).map((tag: string, i: number) => (
                                                                                <Badge key={i} tone="success">{tag.trim()}</Badge>
                                                                            ))}
                                                                        </InlineStack>
                                                                    </BlockStack>
                                                                )}
                                                                {config.removeTags && config.tagsToRemove && (
                                                                    <BlockStack gap="100">
                                                                        <Text variant="bodySm" tone="subdued" as="p">Removing tags</Text>
                                                                        <InlineStack gap="100">
                                                                            {(config.tagsToRemove as string).split(",").filter(Boolean).map((tag: string, i: number) => (
                                                                                <Badge key={i} tone="critical">{tag.trim()}</Badge>
                                                                            ))}
                                                                        </InlineStack>
                                                                    </BlockStack>
                                                                )}
                                                            </>
                                                        )}
                                                    </BlockStack>
                                                </BlockStack>
                                            </Box>
                                        </div>
                                    );
                                })()}

                                {/* Note Card */}
                                <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                    <Box padding="400">
                                        <BlockStack gap="200">
                                            <InlineStack align="space-between">
                                                <Text variant="headingMd" as="h2">Note</Text>
                                                <Button variant="tertiary" size="slim" onClick={() => { setCurrentNote(cleanNote(task.note)); setIsNoteModalOpen(true); }}>Edit</Button>
                                            </InlineStack>
                                            <Text variant="bodyMd" tone={cleanNote(task.note) ? undefined : "subdued"} as="p">
                                                {cleanNote(task.note) || "No notes for the task"}
                                            </Text>
                                        </BlockStack>
                                    </Box>
                                </div>
                            </BlockStack>
                        </Layout.Section>
                    </Layout>
                </BlockStack>

                <Modal
                    open={isScheduleModalOpen}
                    onClose={() => setIsScheduleModalOpen(false)}
                    title="Schedule revert"
                    primaryAction={{
                        content: "Schedule",
                        onAction: handleScheduleRevert,
                    }}
                    secondaryActions={[{ content: "Cancel", onAction: () => setIsScheduleModalOpen(false) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            <Text as="p">Select when you want to automatically revert this task:</Text>
                            <TextField
                                label="Date"
                                type="date"
                                value={scheduleDate}
                                onChange={setScheduleDate}
                                autoComplete="off"
                            />
                            <TextField
                                label="Time"
                                type="time"
                                value={scheduleTime}
                                onChange={setScheduleTime}
                                autoComplete="off"
                            />
                        </BlockStack>
                    </Modal.Section>
                </Modal>

                <Modal
                    open={isRevertModalOpen}
                    onClose={() => setIsRevertModalOpen(false)}
                    title="Confirm revert"
                    primaryAction={{
                        content: "Revert",
                        onAction: handleRevert,
                        destructive: true,
                    }}
                    secondaryActions={[{ content: "Cancel", onAction: () => setIsRevertModalOpen(false) }]}
                >
                    <Modal.Section>
                        <Text as="p">Are you sure you want to revert this edit? All modified fields will be restored to their previous values.</Text>
                    </Modal.Section>
                </Modal>

                <Modal
                    open={isRunAgainModalOpen}
                    onClose={() => setIsRunAgainModalOpen(false)}
                    title="Confirm run again"
                    primaryAction={{
                        content: "Run again",
                        onAction: handleRunAgain,
                    }}
                    secondaryActions={[{ content: "Cancel", onAction: () => setIsRunAgainModalOpen(false) }]}
                >
                    <Modal.Section>
                        <Text as="p">Are you sure you want to run this edit again? The editing process will restart from the beginning.</Text>
                    </Modal.Section>
                </Modal>

                <Modal
                    open={isNoteModalOpen}
                    onClose={() => setIsNoteModalOpen(false)}
                    title="Edit note"
                    primaryAction={{
                        content: "Save",
                        onAction: handleSaveNote,
                        loading: fetcher.state === 'submitting'
                    }}
                    secondaryActions={[{ content: "Cancel", onAction: () => setIsNoteModalOpen(false) }]}
                >
                    <Modal.Section>
                        <TextField
                            label="Note"
                            labelHidden
                            value={currentNote}
                            onChange={setCurrentNote}
                            multiline={4}
                            autoComplete="off"
                            placeholder="Add a note to this task..."
                        />
                    </Modal.Section>
                </Modal>
            </BlockStack>
        </Page>
    );
}
