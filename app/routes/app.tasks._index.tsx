import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
    Page,
    Layout,
    Button,
    Popover,
    ActionList,
    BlockStack,
    Box,
    Text,
    IndexTable,
    SkeletonBodyText,
    SkeletonDisplayText,
    Badge,
    InlineStack,
    Grid,
    Icon,
    Tabs,
    TextField,
    EmptyState,
    Pagination,
    Link,
    Modal,
    ChoiceList,
    Divider,
    Tooltip
} from "@shopify/polaris";
import {
    UndoIcon,
    SettingsIcon,
    PlusIcon,
    SearchIcon,
    SortIcon,
    MenuVerticalIcon,
    ArchiveIcon,
    NoteIcon,
    PlayIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    CheckIcon,
    ProductListIcon,
    CalendarIcon
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useLoaderData, useNavigate, useRevalidator, useSubmit } from "react-router";
import { sendTaskScheduledEmail, sendRevertScheduledEmail } from "../services/email.server";
import { getTaskDescriptionList, getAppliesToText, FIELD_LABELS } from "../utils/task-descriptions";

interface Task {
    id: string;
    jobId: string;
    name: string;
    type: string;
    status: string;
    createdAt: string;
    note?: string;
    revertStatus?: string;
    revertedAt?: string;
    processedProducts?: number;
    totalProducts?: number;
    configuration?: any;
    startTime?: string;
    endTime?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const tab = url.searchParams.get("tab") || "all";
    const q = url.searchParams.get("q") || "";
    const limit = 10;
    const skip = (page - 1) * limit;

    let filters: any[] = [{ shopDomain: shop }];

    // Exclude archived tasks from all tabs except the "Archived" tab itself
    if (tab !== 'archived') {
        filters.push({ status: { not: 'archived' } });
    }

    // Apply tab filters
    if (tab !== 'all') {
        if (tab === 'running') {
            filters.push({
                status: { in: ['running', 'calculating', 'processing'] }
            });
        } else if (tab === 'completed') {
            filters.push({
                OR: [
                    { status: 'completed' },
                    { status: 'reverted' },
                    { revertStatus: 'reverted' }
                ]
            });
        } else if (tab === 'scheduled') {
            filters.push({
                status: 'scheduled'
            });
        } else if (tab === 'revert_completed') {
            filters.push({
                OR: [
                    { status: 'reverted' },
                    { revertStatus: 'reverted' }
                ]
            });
        } else {
            filters.push({ status: tab });
        }
    }

    // Apply search if present
    if (q) {
        filters.push({
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { jobId: { contains: q, mode: 'insensitive' } }
            ]
        });
    }

    let where = { AND: filters };

    try {
        const [tasks, totalCount, allTasksCount] = await Promise.all([
            prisma.priceJob.findMany({
                where: { AND: filters },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.priceJob.count({ where: { AND: filters } }),
            prisma.priceJob.count({ where: { shopDomain: shop } })
        ]);

        return { tasks: tasks || [], totalCount: totalCount || 0, allTasksCount: allTasksCount || 0, page, tab, q };
    } catch (error) {
        console.error("Error fetching tasks:", error);
        return { tasks: [], totalCount: 0, allTasksCount: 0, page, tab, q };
    }
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const jobId = formData.get("jobId") as string;

    if (!jobId) return { ok: false, error: "Missing job ID" };

    if (intent === "archive") {
        try {
            await prisma.priceJob.update({
                where: { jobId, shopDomain: session.shop },
                data: { status: "archived" }
            });
            return { ok: true };
        } catch (error: any) {
            return { ok: false, error: error.message };
        }
    }

    if (intent === "unarchive") {
        try {
            await prisma.priceJob.update({
                where: { jobId, shopDomain: session.shop },
                data: { status: "completed" }
            });
            return { ok: true };
        } catch (error: any) {
            return { ok: false, error: error.message };
        }
    }

    if (intent === "start-task") {
        try {
            await prisma.priceJob.update({
                where: { jobId, shopDomain: session.shop },
                data: { status: "scheduled", startTime: new Date() }
            });

            const [settings, job] = await Promise.all([
                prisma.shopSettings.findUnique({
                    where: { shopDomain: session.shop },
                    select: { contactEmail: true, shopName: true }
                }),
                prisma.priceJob.findUnique({
                    where: { jobId },
                    select: { name: true, configuration: true }
                })
            ]);

            /* 
               Immediate starts from the task list don't need a "Scheduled" email 
               as the task begins processing right away.
            */
            return { ok: true };
        } catch (error: any) {
            console.error("Failed to start task:", error);
            return { ok: false, error: error.message };
        }
    }

    if (intent === "revert") {
        try {
            await prisma.priceJob.update({
                where: { jobId, shopDomain: session.shop },
                data: { revertStatus: "revert_pending", processedProducts: 0 }
            });

            const [settings, job] = await Promise.all([
                prisma.shopSettings.findUnique({
                    where: { shopDomain: session.shop },
                    select: { contactEmail: true, shopName: true }
                }),
                prisma.priceJob.findUnique({
                    where: { jobId },
                    select: { name: true, configuration: true }
                })
            ]);

            if (settings?.contactEmail && job) {
                const editingRules = getTaskDescriptionList(job.configuration || {}).join(" • ");
                const appliesTo = getAppliesToText(job.configuration || {});

                await sendRevertScheduledEmail({
                    taskName: job.name,
                    taskId: jobId,
                    scheduledAt: new Date().toLocaleString(),
                    shopName: settings.shopName || session.shop,
                    shopDomain: session.shop,
                    toEmail: settings.contactEmail,
                    description: [...getTaskDescriptionList(job.configuration, "$"), appliesTo].join(" • "),
                    editingRules,
                    appliesTo
                });
            }
            return { ok: true };
        } catch (error: any) {
            console.error("Failed to schedule revert:", error);
            return { ok: false, error: error.message };
        }
    }

    if (intent === "save-note") {
        const note = formData.get("note") as string;
        try {
            await prisma.priceJob.update({
                where: { jobId, shopDomain: session.shop },
                data: { note: note }
            });
            return { ok: true };
        } catch (error: any) {
            return { ok: false, error: error.message };
        }
    }

    return null;
};

// Helper Functions removed as they are now in utils/task-descriptions.ts

const cleanNote = (note: string | null | undefined) => {
    if (!note) return "";
    return note.replace(/BULK_(QUERY|MUTATION)_ID:gid:\/\/shopify\/BulkOperation\/\d+/g, '').trim();
};

export default function BulkEditTasksPage() {
    const { tasks: loaderTasks, totalCount, allTasksCount, page: loaderPage, tab: loaderTab, q: loaderQ } = useLoaderData() as any;
    const navigate = useNavigate();
    const revalidator = useRevalidator();
    const submit = useSubmit();
    const [tasks, setTasks] = useState(loaderTasks);

    useEffect(() => {
        setTasks(loaderTasks);
    }, [loaderTasks]);

    const tabs = [
        { id: 'all', content: 'All', panelID: 'all-content' },
        { id: 'pending', content: 'Pending', panelID: 'pending-content' },
        { id: 'running', content: 'Running', panelID: 'running-content' },
        { id: 'completed', content: 'Completed', panelID: 'completed-content' },
        { id: 'scheduled', content: 'Scheduled', panelID: 'scheduled-content' },
        { id: 'partially_complete', content: 'Partially complete', panelID: 'partial-content' },
        { id: 'revert_completed', content: 'Revert completed', panelID: 'revert-content' },
        { id: 'archived', content: 'Archived', panelID: 'archived-content' },
    ];

    // UI state
    const [selectedTab, setSelectedTab] = useState(tabs.findIndex((t: any) => t.id === loaderTab) || 0);
    const [searchTerm, setSearchTerm] = useState(loaderQ);
    const [isSearchOpen, setIsSearchOpen] = useState(!!loaderQ);

    const [sortPopoverActive, setSortPopoverActive] = useState(false);
    const [sortValue, setSortValue] = useState('created_at:desc');

    // Pagination
    const [currentPage, setCurrentPage] = useState(loaderPage);
    const rowsPerPage = 10;

    // Popovers & Modals
    const [activePopoverId, setActivePopoverId] = useState<string | null>(null);
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [isRevertModalOpen, setIsRevertModalOpen] = useState(false);
    const [taskToRevert, setTaskToRevert] = useState<Task | null>(null);
    const [currentNote, setCurrentNote] = useState("");
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [newItemPopoverActive, setNewItemPopoverActive] = useState(false);

    const togglePopover = useCallback((id: string) => {
        setActivePopoverId((active) => (active === id ? null : id));
    }, []);

    const toggleNewItemPopover = useCallback(() => setNewItemPopoverActive((active) => !active), []);

    const handleSearchClick = useCallback(() => {
        setIsSearchOpen(true);
    }, []);

    const handleSearchClose = useCallback(() => {
        setIsSearchOpen(false);
        setSearchTerm('');
    }, []);

    // Handle Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isSearchOpen) {
                handleSearchClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSearchOpen, handleSearchClose]);

    const handleAction = (task: Task, action: string) => {
        setActivePopoverId(null);
        if (action === "archive") {
            const formData = new FormData();
            formData.append("intent", "archive");
            formData.append("jobId", task.jobId);
            submit(formData, { method: "post" });
        } else if (action === "unarchive") {
            const formData = new FormData();
            formData.append("intent", "unarchive");
            formData.append("jobId", task.jobId);
            submit(formData, { method: "post" });
        } else if (action === "revert") {
            setTaskToRevert(task);
            setIsRevertModalOpen(true);
        } else if (action === "start") {
            const formData = new FormData();
            formData.append("intent", "start-task");
            formData.append("jobId", task.jobId);
            submit(formData, { method: "post" });
        } else if (action === "note") {
            setActiveTask(task);
            setCurrentNote(task.note || "");
            setIsNoteModalOpen(true);
        }
    };

    const handleConfirmRevert = () => {
        if (!taskToRevert) return;
        const formData = new FormData();
        formData.append("intent", "revert");
        formData.append("jobId", taskToRevert.jobId);
        submit(formData, { method: "post" });
        window.shopify.toast.show("Revert started");
        setIsRevertModalOpen(false);
        setTaskToRevert(null);
    };

    const handleSaveNote = () => {
        if (!activeTask) return;
        const formData = new FormData();
        formData.append("intent", "save-note");
        formData.append("jobId", activeTask.jobId);
        formData.append("note", currentNote);
        submit(formData, { method: "post" });
        setIsNoteModalOpen(false);
        setActiveTask(null);
        setCurrentNote("");
    };

    const handleTabChange = useCallback((selectedTabIndex: number) => {
        setSelectedTab(selectedTabIndex);
        const tabId = tabs[selectedTabIndex].id;
        const formData = new FormData();
        formData.append("tab", tabId);
        formData.append("page", "1");
        if (searchTerm) formData.append("q", searchTerm);
        submit(formData, { method: "get" });
    }, [tabs, searchTerm, submit]);

    // 1. Tab Filtered (now directly uses loaderTasks as it's already filtered by the server)
    const tabFilteredTasks = useMemo(() => {
        return tasks;
    }, [tasks]);

    // 2. Search Logic (redundant now with DB search but kept for secondary local filtering if needed)
    const filteredTasks = useMemo(() => {
        if (!searchTerm) return tabFilteredTasks;

        const lowerQuery = searchTerm.toLowerCase();
        return tabFilteredTasks.filter((task: Task) => {
            const searchStr = [
                task.jobId,
                task.name,
                task.status,
                getAppliesToText(task.configuration || {}),
                getTaskDescriptionList(task.configuration || {}).join(' '),
                new Date(task.createdAt).toLocaleDateString()
            ].join(' ').toLowerCase();
            return searchStr.includes(lowerQuery);
        });
    }, [tabFilteredTasks, searchTerm]);

    // 3. Sorting Logic
    const sortedTasks = useMemo(() => {
        const sorted = [...filteredTasks];
        const [key, direction] = sortValue.split(':');

        sorted.sort((a, b) => {
            let valA: any = a[key === 'created_at' ? 'createdAt' : key as keyof Task] || '';
            let valB: any = b[key === 'created_at' ? 'createdAt' : key as keyof Task] || '';

            if (key === 'created_at') {
                valA = new Date(valA).getTime();
                valB = new Date(valB).getTime();
            } else if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    }, [filteredTasks, sortValue]);

    // Pagination
    const totalItems = totalCount;
    const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
    const currentTasks = sortedTasks;

    const handleNextPage = () => {
        const next = Math.min(currentPage + 1, totalPages);
        const formData = new FormData();
        formData.append("page", next.toString());
        formData.append("tab", tabs[selectedTab].id);
        if (searchTerm) formData.append("q", searchTerm);
        submit(formData, { method: "get" });
    };
    const handlePrevPage = () => {
        const prev = Math.max(currentPage - 1, 1);
        const formData = new FormData();
        formData.append("page", prev.toString());
        formData.append("tab", tabs[selectedTab].id);
        if (searchTerm) formData.append("q", searchTerm);
        submit(formData, { method: "get" });
    };

    // Auto-refresh
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                revalidator.revalidate();
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [revalidator]);

    const menuActions = [
        { content: "Edit Prices", onAction: () => navigate("/app/tasks/new?type=price") },
        { content: "Edit Compare-at Price", onAction: () => navigate("/app/tasks/new?type=compare_price") },
        { content: "Edit Cost", onAction: () => navigate("/app/tasks/new?type=cost") },
        { content: "Edit Inventory", onAction: () => navigate("/app/tasks/new?type=inventory") },
        { content: "Edit Tags", onAction: () => navigate("/app/tasks/new?type=tags") },
        { content: "Edit Status", onAction: () => navigate("/app/tasks/new?type=status") },
        { content: "Edit Metafields", onAction: () => navigate("/app/tasks/new?type=metafield") },
        { content: "Edit Vendor", onAction: () => navigate("/app/tasks/new?type=vendor") },
        { content: "Edit Product Type", onAction: () => navigate("/app/tasks/new?type=product_type") },
        { content: "Edit Weight", onAction: () => navigate("/app/tasks/new?type=weight") },
        { content: "Edit SKU", onAction: () => navigate("/app/tasks/new?type=sku") },
        { content: "Edit Barcode", onAction: () => navigate("/app/tasks/new?type=barcode") },
    ];

    const contentMarkup = useMemo(() => {
        if (totalCount === 0 && searchTerm === '') {
            return (
                <Box padding="800">
                    <EmptyState
                        heading="No tasks found"
                        image="https://cdn.shopify.com/s/files/1/2376/6519/files/empty-state-cart.svg"
                    >
                        <p>There are no tasks matching your current filter. Try adjusting your tab selection.</p>
                    </EmptyState>
                </Box>
            );
        } else if (totalCount === 0 && searchTerm !== '') {
            return (
                <Box padding="800">
                    <EmptyState
                        heading="No tasks found"
                        image="https://cdn.shopify.com/s/files/1/2376/6519/files/empty-state-cart.svg"
                    >
                        <p>Try adjusting your search or sort options.</p>
                    </EmptyState>
                </Box>
            );
        } else {
            return (
                <>
                    <TaskTable
                        tasks={currentTasks}
                        activePopoverId={activePopoverId}
                        togglePopover={togglePopover}
                        handleAction={handleAction}
                    />
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                        <Pagination
                            hasPrevious={currentPage > 1}
                            onPrevious={handlePrevPage}
                            hasNext={currentPage < totalPages}
                            onNext={handleNextPage}
                            label={`${currentPage} of ${totalPages}`}
                        />
                    </div>
                </>
            );
        }
    }, [totalCount, searchTerm, currentTasks, activePopoverId, togglePopover, handleAction, currentPage, totalPages, handlePrevPage, handleNextPage]);


    return (
        <Page fullWidth>
            <BlockStack gap="600">
                {/* Header Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-10%', right: '-5%', width: '200px', height: '200px' }} />
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <BlockStack gap="200">
                            <Text as="h1" variant="heading2xl" fontWeight="bold">
                                Bulk Edit Tasks
                            </Text>
                            <Box maxWidth="600px">
                                <Text as="p" variant="bodyLg">
                                    <span style={{ opacity: 0.9 }}>Monitor and manage your price update campaigns accurately.</span>
                                </Text>
                            </Box>
                        </BlockStack>
                        <Popover
                            active={newItemPopoverActive}
                            activator={
                                <Button
                                    variant="primary"
                                    size="large"
                                    icon={PlusIcon}
                                    onClick={toggleNewItemPopover}
                                    disclosure
                                >
                                    New Bulk Edit Task
                                </Button>
                            }
                            onClose={toggleNewItemPopover}
                        >
                            <ActionList
                                actionRole="menuitem"
                                items={[
                                    { content: 'Price', onAction: () => navigate("/app/tasks/new?type=price") },
                                    { content: 'Compare at price', onAction: () => navigate("/app/tasks/new?type=compare_price") },
                                    { content: 'Cost', onAction: () => navigate("/app/tasks/new?type=cost") },
                                    { content: 'Inventory', onAction: () => navigate("/app/tasks/new?type=inventory") },
                                    { content: 'Tags', onAction: () => navigate("/app/tasks/new?type=tags") },
                                    { content: 'Status', onAction: () => navigate("/app/tasks/new?type=status") },
                                    { content: 'Vendor', onAction: () => navigate("/app/tasks/new?type=vendor") },
                                    { content: 'Product type', onAction: () => navigate("/app/tasks/new?type=product_type") },
                                    { content: 'Weight', onAction: () => navigate("/app/tasks/new?type=weight") },
                                    { content: 'Requires shipping', onAction: () => navigate("/app/tasks/new?type=requires_shipping") },
                                    { content: 'Taxable', onAction: () => navigate("/app/tasks/new?type=taxable") },
                                    { content: 'Metafield', onAction: () => navigate("/app/tasks/new?type=metafield") },
                                    { content: 'Title', onAction: () => navigate("/app/tasks/new?type=title") },
                                    { content: 'Body HTML', onAction: () => navigate("/app/tasks/new?type=body_html") },
                                    { content: 'Handle', onAction: () => navigate("/app/tasks/new?type=handle") },
                                    { content: 'Template Suffix', onAction: () => navigate("/app/tasks/new?type=template_suffix") },
                                    { content: 'Published Status', onAction: () => navigate("/app/tasks/new?type=published") },
                                    { content: 'Inventory Policy', onAction: () => navigate("/app/tasks/new?type=inventory_policy") },
                                    { content: 'SKU', onAction: () => navigate("/app/tasks/new?type=sku") },
                                    { content: 'Barcode', onAction: () => navigate("/app/tasks/new?type=barcode") },
                                    { content: 'SEO Title', onAction: () => navigate("/app/tasks/new?type=seo_title") },
                                    { content: 'SEO Description', onAction: () => navigate("/app/tasks/new?type=seo_description") },
                                    { content: 'Google Product Category', onAction: () => navigate("/app/tasks/new?type=google_product_category") },
                                    { content: 'Google Custom Label 0', onAction: () => navigate("/app/tasks/new?type=google_custom_label_0") },
                                    { content: 'Google Custom Label 1', onAction: () => navigate("/app/tasks/new?type=google_custom_label_1") },
                                    { content: 'Google Custom Label 2', onAction: () => navigate("/app/tasks/new?type=google_custom_label_2") },
                                    { content: 'Google Custom Label 3', onAction: () => navigate("/app/tasks/new?type=google_custom_label_3") },
                                    { content: 'Google Custom Label 4', onAction: () => navigate("/app/tasks/new?type=google_custom_label_4") },
                                ]}
                            />
                        </Popover>
                    </div>
                </div>

                <Layout>
                    <Layout.Section>
                        {allTasksCount === 0 ? (
                            <CommandCenterEmptyState menuActions={menuActions} />
                        ) : (
                            <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                {/* Search/Sort Header Row */}
                                <div style={{
                                    borderBottom: '1px solid #e1e3e5',
                                    padding: '8px 16px',
                                    height: '56px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 25,
                                    background: 'white'
                                }}>
                                    {!isSearchOpen ? (
                                        <>
                                            <div style={{ flex: 1, overflowX: 'auto' }}>
                                                <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} fitted={false} />
                                            </div>
                                            <InlineStack gap="200" align="end">
                                                <Button
                                                    icon={SearchIcon}
                                                    onClick={handleSearchClick}
                                                    accessibilityLabel="Open search"
                                                />
                                                <SortPopover
                                                    active={sortPopoverActive}
                                                    setActive={setSortPopoverActive}
                                                    sortValue={sortValue}
                                                    setSortValue={setSortValue}
                                                />
                                            </InlineStack>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ flex: 1 }} onBlur={(e) => {
                                                if (!e.currentTarget.contains(e.relatedTarget)) {
                                                    // Only close if we really lost focus to outside the input group
                                                    // handleSearchClose(); // Removed automatic close on blur to prevent accidental closing
                                                }
                                            }}>
                                                <TextField
                                                    label="Search task"
                                                    labelHidden
                                                    value={searchTerm}
                                                    onChange={(val) => {
                                                        setSearchTerm(val);
                                                        const formData = new FormData();
                                                        formData.append("q", val);
                                                        formData.append("tab", tabs[selectedTab].id);
                                                        formData.append("page", "1");
                                                        submit(formData, { method: "get" });
                                                    }}
                                                    placeholder="Search task"
                                                    autoComplete="off"
                                                    prefix={<Icon source={SearchIcon} />}
                                                    clearButton
                                                    onClearButtonClick={() => {
                                                        handleSearchClose();
                                                        const formData = new FormData();
                                                        formData.append("tab", tabs[selectedTab].id);
                                                        formData.append("page", "1");
                                                        submit(formData, { method: "get" });
                                                    }}
                                                    autoFocus
                                                    suffix={
                                                        <Button
                                                            variant="plain"
                                                            onClick={() => {
                                                                handleSearchClose();
                                                                const formData = new FormData();
                                                                formData.append("tab", tabs[selectedTab].id);
                                                                formData.append("page", "1");
                                                                submit(formData, { method: "get" });
                                                            }}
                                                        >
                                                            Cancel
                                                        </Button>
                                                    }
                                                />
                                            </div>
                                            <div style={{ marginLeft: '12px' }}>
                                                <SortPopover
                                                    active={sortPopoverActive}
                                                    setActive={setSortPopoverActive}
                                                    sortValue={sortValue}
                                                    setSortValue={setSortValue}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>

                                {contentMarkup}
                            </div>
                        )}

                        <Box paddingBlockStart="400" paddingBlockEnd="800">
                            <BlockStack inlineAlign="center">
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    Learn more about <Link url="https://help.shopify.com" target="_blank">Bulk Edit Tasks</Link>
                                </Text>
                            </BlockStack>
                        </Box>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            {/* Modals */}
            <Modal
                open={isRevertModalOpen}
                onClose={() => setIsRevertModalOpen(false)}
                title="Confirm revert"
                primaryAction={{
                    content: "Revert",
                    destructive: true,
                    onAction: handleConfirmRevert,
                }}
                secondaryActions={[{ content: "Cancel", onAction: () => setIsRevertModalOpen(false) }]}
            >
                <Modal.Section>
                    <p>Are you sure you want to revert this edit? All modified fields will be restored to their previous values.</p>
                </Modal.Section>
            </Modal>

            <Modal
                open={isNoteModalOpen}
                onClose={() => setIsNoteModalOpen(false)}
                title="Add Note"
                primaryAction={{
                    content: "Save",
                    onAction: handleSaveNote,
                }}
                secondaryActions={[{ content: "Cancel", onAction: () => setIsNoteModalOpen(false) }]}
            >
                <Modal.Section>
                    <TextField
                        label="Note"
                        value={currentNote}
                        onChange={setCurrentNote}
                        multiline={4}
                        autoComplete="off"
                        maxLength={500}
                        showCharacterCount
                    />
                </Modal.Section>
            </Modal>
        </Page>
    );
}
function SortPopover({ active, setActive, sortValue, setSortValue }: any) {
    const choices = [
        { label: 'Newest', value: 'created_at:desc' },
        { label: 'Oldest', value: 'created_at:asc' },
        { label: 'Name (A-Z)', value: 'name:asc' },
        { label: 'Name (Z-A)', value: 'name:desc' },
    ];

    return (
        <Popover
            active={active}
            activator={
                <Button
                    icon={SortIcon}
                    onClick={() => setActive(!active)}
                    disclosure
                >
                    Sort
                </Button>
            }
            onClose={() => setActive(false)}
        >
            <Box padding="200" minWidth="180px">
                <ActionList
                    actionRole="menuitem"
                    items={choices.map(choice => ({
                        content: choice.label,
                        active: sortValue === choice.value,
                        onAction: () => {
                            setSortValue(choice.value);
                            setActive(false);
                        },
                        suffix: sortValue === choice.value ? <Icon source={CheckIcon} tone="success" /> : null
                    }))}
                />
            </Box>
        </Popover>
    );
}

function CommandCenterEmptyState({ menuActions }: { menuActions: any[] }) {
    const navigate = useNavigate();
    return (
        <div className="stat-card" style={{ overflow: 'hidden' }}>
            <Box padding="800">
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'radial-gradient(circle at center, rgba(79, 70, 229, 0.03) 0%, transparent 70%)',
                    borderRadius: '24px',
                    padding: '40px 0'
                }}>
                    <EmptyState
                        heading="Get started with Bulk Editing"
                        action={{ content: 'New Bulk Edit Task', onAction: () => navigate("/app/tasks/new") }}
                        image="https://cdn.shopify.com/s/files/1/2376/6519/files/empty-state-cart.svg"
                    >
                        <div style={{ maxWidth: '400px', margin: '0 auto' }}>
                            <Text as="p" variant="bodyLg" tone="subdued">
                                Quickly edit product fields at scale with live previews, scheduled changes, and rollbacks — all in one place.
                            </Text>
                        </div>
                    </EmptyState>
                </div>
            </Box>
        </div>
    );
}

function TaskTable({ tasks, activePopoverId, togglePopover, handleAction }: {
    tasks: Task[],
    activePopoverId: string | null,
    togglePopover: (id: string) => void,
    handleAction: (task: Task, action: string) => void
}) {
    const navigate = useNavigate();

    const rowMarkup = tasks.map((task, index) => {
        const { jobId, name, status, createdAt, processedProducts, totalProducts, revertedAt, configuration, note, startTime, revertStatus } = task;

        const appliesTo = getAppliesToText(configuration || {});
        const rules = getTaskDescriptionList(configuration || {}).join(" • ");

        let fieldLabel = FIELD_LABELS[configuration?.fieldToEdit as string] || configuration?.fieldToEdit || "Price";

        // Special handling for dynamic prefixes in the history table
        if (typeof configuration?.fieldToEdit === 'string') {
            if (configuration.fieldToEdit.startsWith('metafield:')) {
                fieldLabel = "Metafield";
            } else if (configuration.fieldToEdit.startsWith('publication:')) {
                fieldLabel = "Sales Channels";
            } else if (configuration.fieldToEdit.startsWith('market_publishing:')) {
                fieldLabel = "Market Publishing";
            } else if (configuration.fieldToEdit.startsWith('market_price:')) {
                fieldLabel = "Market Price";
            }
        }

        let progressText: React.ReactNode = "";
        const isEffectiveCompleted = status === 'completed' || status === 'reverted' || revertStatus === 'reverted';

        if (status === 'running' || revertStatus === 'reverting' || revertStatus === 'revert_pending') {
            if (status === 'running') {
                progressText = (
                    <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">Running...</Text>
                        <div style={{ width: '60px', height: '4px', background: '#e1e3e5', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, Math.round((processedProducts || 0) / (totalProducts || 1) * 100))}%`, height: '100%', background: '#005bd3' }}></div>
                        </div>
                    </BlockStack>
                );
            } else {
                progressText = <Text as="span" variant="bodySm" tone="success">100% Changed</Text>;
            }
        } else if (isEffectiveCompleted) {
            progressText = <Text as="span" variant="bodySm" tone="subdued">Done ({totalProducts} items)</Text>;
        } else if (status === 'scheduled' && startTime) {
            const sDate = new Date(startTime);
            const isFuture = sDate > new Date();

            if (isFuture) {
                progressText = (
                    <Badge tone="info">
                        {sDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })}
                    </Badge>
                );
            } else {
                // Scheduled task is now running
                progressText = (
                    <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">Running...</Text>
                        <div style={{ width: '60px', height: '4px', background: '#e1e3e5', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, Math.round((processedProducts || 0) / (totalProducts || 1) * 100))}%`, height: '100%', background: '#005bd3' }}></div>
                        </div>
                    </BlockStack>
                );
            }
        } else {
            progressText = <Text as="span" variant="bodyMd">{totalProducts} items</Text>;
        }

        let revertTime = <Text as="span" variant="bodyMd" tone="subdued">-</Text>;
        if (revertedAt) {
            revertTime = <Text as="span" variant="bodyMd">{new Date(revertedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>;
        } else if (revertStatus === 'revert_pending' || revertStatus === 'reverting') {
            revertTime = <Badge tone="attention">Reverting...</Badge>;
        }

        const numericId = parseInt(jobId.replace(/-/g, '').substring(0, 8), 16) % 100000;
        const displayId = numericId.toString().padStart(5, '0');

        const actionItems = [];
        if (status === 'completed' && (!revertStatus || revertStatus === 'none')) {
            actionItems.push({ content: 'Revert', icon: UndoIcon, onAction: () => handleAction(task, 'revert') });
        }
        if (status === 'scheduled') {
            actionItems.push({ content: 'Edit', icon: SettingsIcon, onAction: () => navigate(`/app/tasks/new?edit=${jobId}`) });
            actionItems.push({ content: 'Apply changes now', icon: PlayIcon, onAction: () => handleAction(task, 'start') });
        }
        if (status === 'pending') {
            actionItems.push({ content: 'Apply changes now', icon: PlayIcon, onAction: () => handleAction(task, 'start') });
        }
        if (status === 'archived') {
            actionItems.push({ content: 'Unarchive', icon: UndoIcon, onAction: () => handleAction(task, 'unarchive') });
        } else {
            actionItems.push({ content: 'Archive', icon: ArchiveIcon, onAction: () => handleAction(task, 'archive') });
        }
        actionItems.push({ content: 'Note', icon: NoteIcon, onAction: () => handleAction(task, 'note') });

        let statusBadge = getStatusBadge(status, startTime);
        if (status === 'reverted' || revertStatus === 'reverted') {
            statusBadge = <Badge tone="success">Revert completed</Badge>;
        } else if (revertStatus === 'revert_pending' || revertStatus === 'reverting') {
            statusBadge = <Badge tone="warning">Reverting...</Badge>;
        }

        return (
            <IndexTable.Row
                id={jobId}
                key={jobId}
                position={index}
                onClick={() => navigate(`/app/tasks/${jobId}`)}
            >
                <IndexTable.Cell><Text variant="headingSm" as="span">#{displayId}</Text></IndexTable.Cell>
                <IndexTable.Cell>
                    <InlineStack gap="200" align="start">
                        <Text variant="bodyMd" fontWeight="semibold" as="span">{name}</Text>
                        {cleanNote(note) && (
                            <Tooltip content={cleanNote(note)}>
                                <Icon source={NoteIcon} tone="subdued" />
                            </Tooltip>
                        )}
                    </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell>{statusBadge}</IndexTable.Cell>
                <IndexTable.Cell>{progressText}</IndexTable.Cell>
                <IndexTable.Cell>{revertTime}</IndexTable.Cell>
                <IndexTable.Cell>{appliesTo}</IndexTable.Cell>
                <IndexTable.Cell>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Badge tone="info">{fieldLabel}</Badge>
                        <Text as="span" variant="bodySm">{rules}</Text>
                    </div>
                </IndexTable.Cell>
                <IndexTable.Cell>{new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</IndexTable.Cell>
                <IndexTable.Cell>
                    <div onClick={(e) => e.stopPropagation()}>
                        <Popover
                            active={activePopoverId === jobId}
                            activator={<Button variant="plain" icon={MenuVerticalIcon} onClick={() => togglePopover(jobId)} />}
                            onClose={() => togglePopover(jobId)}
                        >
                            <ActionList actionRole="menuitem" items={actionItems} />
                        </Popover>
                    </div>
                </IndexTable.Cell>
            </IndexTable.Row>
        );
    });

    return (
        <IndexTable
            resourceName={{ singular: "task", plural: "tasks" }}
            itemCount={tasks.length}
            headings={[
                { title: "ID" },
                { title: "Name" },
                { title: "Status" },
                { title: "Progress" },
                { title: "Revert time" },
                { title: "Applies to" },
                { title: "Editing rules" },
                { title: "Created at" },
                { title: "" },
            ]}
            selectable={false}
        >
            {rowMarkup}
        </IndexTable>
    );
}

function getStatusBadge(status: string, startTime?: string | Date | null) {
    const isScheduledProcessing = status === 'scheduled' && startTime && new Date(startTime) <= new Date();

    switch (status) {
        case 'completed': return <Badge tone="success">Completed</Badge>;
        case 'running': return <Badge tone="info">Processing</Badge>;
        case 'scheduled': return isScheduledProcessing ? <Badge tone="info">Processing</Badge> : <Badge tone="info">Scheduled</Badge>;
        case 'pending': return <Badge>Manual Start</Badge>;
        case 'reverted': return <Badge tone="success">Revert completed</Badge>;
        case 'reverting': return <Badge tone="attention">Reverting</Badge>;
        case 'failed': return <Badge tone="critical">Failed</Badge>;
        case 'archived': return <Badge>Archived</Badge>;
        default: return <Badge>{status}</Badge>;
    }
}

export const headers = (headersArgs: any) => {
    return boundary.headers(headersArgs);
};

// Note: Duplicate cleanNote removed and consolidated at the top of the file

