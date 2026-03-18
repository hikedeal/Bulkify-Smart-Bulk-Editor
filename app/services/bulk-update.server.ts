import { trackEvent } from "./analytics.server";
import prisma from "../db.server";
import shopify, { sessionStorage } from "../shopify.server";
import * as readline from 'node:readline';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

// DEBUG LOGGING HELPER
function logDebug(message: string) {
    try {
        fs.appendFileSync('debug_job.txt', `[${new Date().toISOString()}] ${message}\n`);
    } catch (e) {
        console.error("Failed to write to debug_job.txt", e);
    }
}
import {
    sendTaskCompletedEmail,
    sendTaskFailedEmail,
    sendRevertCompletedEmail,
    sendRevertFailedEmail,
    sendTaskScheduledEmail,
    sendRevertScheduledEmail
} from "./email.server";
import { getTaskDescriptionList, getAppliesToText } from "../utils/task-descriptions";
import { createStagedUpload, uploadJsonl, runBulkMutation, runBulkQuery } from "./bulk-operation.server";
import { applyRulesToVariant, applyRounding } from "../utils/rule-engine";

const BULK_THRESHOLD = 100; // Switch to Bulk API for > 100 updates



// Helper to get authenticated admin client for background jobs
async function getAuthenticatedAdmin(shopDomain: string) {
    // Find the offline session for this shop
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    const offlineSession = sessions.find((s: any) => s.isOnline === false);

    if (!offlineSession || !offlineSession.accessToken) {
        throw new Error(`No offline session found for shop: ${shopDomain}`);
    }

    // Create a simple admin object with graphql method
    return {
        graphql: async (query: string, options?: { variables?: any }) => {
            const maxRetries = 5;
            let attempt = 0;

            while (attempt < maxRetries) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds

                try {
                    const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': offlineSession.accessToken!,
                        },
                        body: JSON.stringify({
                            query,
                            variables: options?.variables,
                        }),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (response.status === 429) {
                        const retryAfter = response.headers.get('Retry-After');
                        const waitTime = retryAfter ? parseFloat(retryAfter) * 1000 : 2000;
                        console.warn(`[Shopify API] 429 Rate limit hit. Waiting ${waitTime}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime + 500));
                        attempt++;
                        continue;
                    }

                    // Proactive throttling using cost extensions
                    try {
                        const clonedRes = response.clone();
                        const json = await clonedRes.json() as any;
                        const cost = json.extensions?.cost;

                        if (cost) {
                            const { currentlyAvailable, restoreRate, requestedQueryCost } = cost.throttleStatus || {};
                            const actualCost = cost.actualQueryCost || requestedQueryCost || 0;

                            if (currentlyAvailable < (actualCost * 2) || currentlyAvailable < 50) {
                                const minWait = Math.ceil((actualCost / (restoreRate || 50)) * 1000);
                                const waitTime = Math.max(minWait, 1000);
                                console.log(`[Shopify API] Budget low (${currentlyAvailable}/${cost.throttleStatus?.maximumAvailable || '?'}). Throttling for ${waitTime}ms...`);
                                await new Promise(resolve => setTimeout(resolve, waitTime));
                            }
                        }
                    } catch (costErr) {
                        // Ignore cost check failures, they are optional
                    }

                    return response;

                } catch (e: any) {
                    clearTimeout(timeoutId);
                    if (e.name === 'AbortError') {
                        console.error(`[Shopify API] Request timed out after 30s. Attempt ${attempt + 1}/${maxRetries}`);
                    } else {
                        console.error(`[Shopify API] Request failed:`, e);
                    }
                    attempt++;
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
            throw new Error("Max retries exceeded for Shopify API");
        }
    };
}

async function getMarketPriceLists(shopifyAdmin: any, selectedMarkets: string[]) {
    const marketPriceLists: Record<string, { priceListId: string, currency: string }> = {};
    if (!selectedMarkets || selectedMarkets.length === 0) return marketPriceLists;

    try {
        const marketInfoRes = await shopifyAdmin.graphql(`
            query getMarketsForJob {
                markets(first: 50) {
                    nodes {
                        handle

                        catalogue {
                            id
                            ... on BusinessCatalogue { priceList { id } }
                            ... on ConsumerCatalogue { priceList { id } }
                        }
                    }
                }
            }
        `);
        const marketInfo = await marketInfoRes.json() as any;
        marketInfo.data?.markets?.nodes?.forEach((m: any) => {
            const priceListId = m.catalogue?.priceList?.id;
            if (priceListId && selectedMarkets?.includes(m.handle)) {
                marketPriceLists[m.handle] = {
                    priceListId,
                    currency: "USD"
                };
            }
        });
    } catch (e) {
        console.error("Failed to fetch market price lists:", e);
    }
    return marketPriceLists;
}

// --- RECURSION PROTECTION ---
let isProcessing = false;

export async function processPendingJobs() {
    if (isProcessing) {
        console.log("processPendingJobs already running, skipping this tick.");
        return;
    }
    isProcessing = true;
    try {
        await _internalProcessPendingJobs();
    } finally {
        isProcessing = false;
    }
}

async function _internalProcessPendingJobs() {
    console.log("Checking for pending jobs...");

    // 1. Process Start actions
    try {
        const scheduledJobs = await prisma.priceJob.findMany({
            where: {
                status: "scheduled",
                startTime: { lte: new Date() }
            }
        });

        if (scheduledJobs.length > 0) {
            console.log(`Found ${scheduledJobs.length} jobs to start.`);
            for (const job of scheduledJobs) {
                await runJob(job);
            }
        }
    } catch (scheduledError) {
        console.error("Error fetching scheduled jobs:", scheduledError);
    }

    // 2. Process Revert actions
    try {
        const revertJobs = await prisma.priceJob.findMany({
            where: {
                OR: [
                    {
                        revertStatus: "scheduled",
                        scheduledRevertAt: { lte: new Date() }
                    },
                    {
                        revertStatus: "revert_pending"
                    }
                ]
            }
        });

        if (revertJobs.length > 0) {
            console.log(`Found ${revertJobs.length} jobs to revert.`);
            for (const job of revertJobs) {
                await revertJob(job);
            }
        }
    } catch (revertError) {
        console.error("Error fetching jobs to revert:", revertError);
    }

    // 2.5 Process Active Bulk Queries (Fetching phase)
    try {
        const fetchingJobs = await prisma.priceJob.findMany({
            where: {
                status: "calculating",
                note: { contains: "BULK_QUERY_ID:" }
            }
        });

        if (fetchingJobs.length > 0) {
            console.log(`Checking status for ${fetchingJobs.length} active bulk queries...`);
            for (const job of fetchingJobs) {
                const bulkOpIdMatch = job.note?.match(/gid:\/\/shopify\/BulkOperation\/\d+/);
                if (bulkOpIdMatch) {
                    const bulkOpId = bulkOpIdMatch[0];
                    try {
                        const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);
                        const res = await shopifyAdmin.graphql(
                            `query getBulkOperation($id: ID!) {
                                node(id: $id) {
                                    ... on BulkOperation {
                                        id
                                        status
                                        url
                                        errorCode
                                    }
                                }
                            }`,
                            { variables: { id: bulkOpId } }
                        );
                        const json = await res.json() as any;
                        const op = json.data?.node;

                        if (op) {
                            if (op.status === 'COMPLETED') {
                                console.log(`Bulk Query ${bulkOpId} completed. Processing results for job ${job.jobId}...`);
                                if (op.url) {
                                    await processBulkQueryResult(job, op.url);
                                } else {
                                    throw new Error("Bulk Query completed but no URL provided");
                                }
                            } else if (['FAILED', 'CANCELED', 'EXPIRED'].includes(op.status)) {
                                const errorMsg = `Shopify Bulk Query ${op.status}: ${op.errorCode || 'Unknown error'}`;
                                await prisma.priceJob.update({
                                    where: { jobId: job.jobId },
                                    data: { status: 'failed', error: errorMsg }
                                });
                                await sendJobCompletionEmail({ ...job, error: errorMsg }, "failed");
                            }
                        } else {
                            // op is null - record is gone from Shopify!
                            console.error(`Bulk Query ID ${bulkOpId} not found on Shopify for job ${job.jobId}. Failing task.`);
                            await prisma.priceJob.update({
                                where: { jobId: job.jobId },
                                data: {
                                    status: 'failed',
                                    error: "Shopify Bulk Operation record could not be found. This can happen if the operation was cancelled or expired on Shopify's end."
                                }
                            });
                        }
                    } catch (err) {
                        console.error(`Failed to poll bulk query ${bulkOpId}:`, err);
                    }
                }
            }
        }
    } catch (fetchingError) {
        console.error("Error fetching calculating jobs:", fetchingError);
    }

    // 3. Process Active Bulk Operations
    try {
        const processingJobs = await prisma.priceJob.findMany({
            where: {
                status: "processing",
                note: { not: null }
            }
        });

        if (processingJobs.length > 0) {
            console.log(`Checking status for ${processingJobs.length} active bulk operations...`);
            for (const job of processingJobs) {
                const bulkOpIdMatch = job.note?.match(/gid:\/\/shopify\/BulkOperation\/\d+/);
                if (bulkOpIdMatch) {
                    const bulkOpId = bulkOpIdMatch[0];
                    try {
                        const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);
                        const res = await shopifyAdmin.graphql(
                            `query getBulkOperation($id: ID!) {
                                node(id: $id) {
                                    ... on BulkOperation {
                                        id
                                        status
                                        url
                                        errorCode
                                        completedAt
                                    }
                                }
                            }`,
                            { variables: { id: bulkOpId } }
                        );
                        const json = await res.json() as any;
                        const op = json.data?.node;

                        if (op) {
                            if (op.status === 'COMPLETED') {
                                await prisma.priceJob.update({
                                    where: { jobId: job.jobId },
                                    data: {
                                        status: 'completed',
                                        completedAt: op.completedAt ? new Date(op.completedAt) : new Date(),
                                        processedProducts: job.totalProducts
                                    }
                                });

                                await trackEvent(job.shopDomain, 'task_completed');
                                console.log(`Bulk Operation ${bulkOpId} completed for job ${job.jobId}. Results URL: ${op.url || "None"}`);

                                // Send completion email
                                await sendJobCompletionEmail(job, "completed");
                            } else if (['FAILED', 'CANCELED', 'EXPIRED'].includes(op.status)) {
                                const errorMsg = `Shopify Bulk Operation ${op.status}: ${op.errorCode || 'Unknown error'}`;
                                await prisma.priceJob.update({
                                    where: { jobId: job.jobId },
                                    data: {
                                        status: 'failed',
                                        error: errorMsg
                                    }
                                });

                                await sendJobCompletionEmail({ ...job, error: errorMsg }, "failed");
                            }
                        } else {
                            // op is null - record is gone!
                            console.error(`Bulk Operation ID ${bulkOpId} not found on Shopify for job ${job.jobId}. Failing task.`);
                            await prisma.priceJob.update({
                                where: { jobId: job.jobId },
                                data: {
                                    status: 'failed',
                                    error: "Shopify Bulk Operation record could not be found. It may have been aborted or expired."
                                }
                            });
                        }
                    } catch (err) {
                        console.error(`Failed to poll bulk operation ${bulkOpId}:`, err);
                    }
                }
            }
        }
    } catch (processingError) {
        console.error("Error fetching processing jobs:", processingError);
    }

    // 4. Process Active Bulk Reverts
    try {
        const revertingJobs = await prisma.priceJob.findMany({
            where: {
                revertStatus: "reverting",
                note: { contains: "BULK_REVERT_ID:" }
            }
        });

        if (revertingJobs.length > 0) {
            console.log(`Checking status for ${revertingJobs.length} active bulk reverts...`);
            for (const job of revertingJobs) {
                const bulkOpIdMatch = job.note?.match(/gid:\/\/shopify\/BulkOperation\/\d+/);
                if (bulkOpIdMatch) {
                    const bulkOpId = bulkOpIdMatch[0];
                    try {
                        const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);
                        const res = await shopifyAdmin.graphql(
                            `query getBulkOperation($id: ID!) {
                                node(id: $id) {
                                    ... on BulkOperation {
                                        id
                                        status
                                        errorCode
                                        completedAt
                                    }
                                }
                            }`,
                            { variables: { id: bulkOpId } }
                        );
                        const json = await res.json() as any;
                        const op = json.data?.node;

                        if (op) {
                            if (op.status === 'COMPLETED') {
                                await prisma.priceJob.update({
                                    where: { jobId: job.jobId },
                                    data: {
                                        revertStatus: 'reverted',
                                        revertedAt: op.completedAt ? new Date(op.completedAt) : new Date(),
                                        status: 'reverted'
                                    }
                                });

                                console.log(`Bulk Revert ${bulkOpId} completed for job ${job.jobId}`);

                                // Send revert completion email
                                try {
                                    const settings = await prisma.shopSettings.findUnique({ where: { shopDomain: job.shopDomain } });
                                    if (settings?.contactEmail) {
                                        await sendRevertCompletedEmail({
                                            taskName: (job.configuration as any)?.taskName || `Task #${job.jobId.substring(0, 8)}`,
                                            taskId: job.jobId,
                                            productsCount: job.totalProducts || 0,
                                            completedAt: new Date().toLocaleString(),
                                            shopName: settings.shopName || job.shopDomain,
                                            shopDomain: job.shopDomain,
                                            toEmail: settings.contactEmail,
                                            editingRules: getTaskDescriptionList(job.configuration || {}).join(" • "),
                                            appliesTo: getAppliesToText(job.configuration || {})
                                        });
                                    }
                                } catch (e) {
                                    console.error("Failed to send revert email:", e);
                                }

                            } else if (['FAILED', 'CANCELED', 'EXPIRED'].includes(op.status)) {
                                const errorMsg = `Shopify Bulk Revert ${op.status}: ${op.errorCode || 'Unknown error'}`;
                                await prisma.priceJob.update({
                                    where: { jobId: job.jobId },
                                    data: {
                                        revertStatus: 'failed',
                                        error: errorMsg
                                    }
                                });
                                // Send revert failure email
                                try {
                                    const settings = await prisma.shopSettings.findUnique({ where: { shopDomain: job.shopDomain } });
                                    if (settings?.contactEmail) {
                                        await sendRevertFailedEmail({
                                            taskName: (job.configuration as any)?.taskName || `Task #${job.jobId.substring(0, 8)}`,
                                            taskId: job.jobId,
                                            error: errorMsg,
                                            shopName: settings.shopName || job.shopDomain,
                                            shopDomain: job.shopDomain,
                                            toEmail: settings.contactEmail
                                        });
                                    }
                                } catch (e) {
                                    console.error("Failed to send revert email:", e);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to poll bulk revert ${bulkOpId}:`, err);
                    }
                }
            }
        }
    } catch (revertPollingError) {
        console.error("Error fetching reverting jobs:", revertPollingError);
    }
}

async function sendJobCompletionEmail(job: any, outcome: "completed" | "failed") {
    try {
        const settings = await prisma.shopSettings.findUnique({
            where: { shopDomain: job.shopDomain }
        });

        if (settings?.contactEmail) {
            const config = (job.configuration as any) || {};
            const startTime = job.startTime ? new Date(job.startTime).getTime() : new Date(job.createdAt).getTime();
            const durationMs = Date.now() - startTime;
            const minutes = Math.floor(durationMs / 60000);
            const seconds = Math.floor((durationMs % 60000) / 1000);

            // Fetch Currency
            const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);
            const shopRes = await shopifyAdmin.graphql(`{ shop { currencyCode } }`);
            const shopJson = await shopRes.json() as any;
            const currency = shopJson.data?.shop?.currencyCode || "USD";

            const descriptions = getTaskDescriptionList(config, currency);
            const editingRules = descriptions.join(" • ");
            const appliesTo = getAppliesToText(config);
            const description = [...descriptions, appliesTo].join(" • ");

            if (outcome === "completed") {
                await sendTaskCompletedEmail({
                    taskName: config.taskName || `Task #${job.jobId.substring(0, 8)}`,
                    taskId: job.jobId,
                    productsCount: job.totalProducts,
                    duration: `${minutes}m ${seconds}s`,
                    completedAt: new Date().toLocaleString(),
                    shopName: settings.shopName || job.shopDomain,
                    shopDomain: job.shopDomain,
                    toEmail: settings.contactEmail,
                    description: description,
                    editingRules: editingRules,
                    appliesTo: appliesTo
                });
            } else {
                await sendTaskFailedEmail({
                    taskName: config.taskName || `Task #${job.jobId.substring(0, 8)}`,
                    taskId: job.jobId,
                    completedAt: new Date().toLocaleString(),
                    error: job.error || "Unknown error occurred",
                    shopName: settings.shopName || job.shopDomain,
                    shopDomain: job.shopDomain,
                    toEmail: settings.contactEmail,
                    description: description,
                    editingRules: editingRules,
                    appliesTo: appliesTo
                });
            }
        }
    } catch (err) {
        console.error("Failed to send completion email:", err);
    }
}

// applyRounding is now in rule-engine.ts

// Helper for Text Edits (Vendor, Product Type, Tags)
function applyTextEdit(originalText: string, method: string, inputs: { value?: string, findText?: string, replaceText?: string, prefixValue?: string, suffixValue?: string }) {
    const original = originalText || "";
    switch (method) {
        case 'fixed':
        case 'set_value':
        case 'set_vendor':
        case 'set_type':
            return inputs.value || "";
        case 'clear_value':
        case 'clear_vendor':
        case 'clear_type':
            return "";
        case 'add_prefix':
            return (inputs.prefixValue || "") + original;
        case 'add_suffix':
            return original + (inputs.suffixValue || "");
        case 'find_replace':
        case 'replace_text':
            if (!inputs.findText) return original;
            return original.split(inputs.findText).join(inputs.replaceText || "");
        default:
            return original;
    }
}

/**
 * Persists detailed item-level results to the task_run_items table for backend analytics.
 */
async function bulkLogRunItems(runId: string, shop: string, fieldName: string, updates: any[], status: 'success' | 'failed', errorMessage?: string, metadata: any = {}) {
    if (!runId || !updates || updates.length === 0) return;

    const logItems = updates.map(u => ({
        runId: runId,
        shop: shop,
        productId: String(u.id || u.ownerId || ""), // ownerId for metafields
        productTitle: u.title || "Unknown Item",
        fieldName: fieldName,
        originalValue: String(u.logOriginal ?? ""),
        newValue: String(u.logNew ?? ""),
        status: status,
        errorMessage: errorMessage || u.errorMessage,
        metadata: { ...metadata, ...(u.metadata || {}) }
    }));

    try {
        await prisma.taskRunItem.createMany({
            data: logItems
        });
    } catch (error) {
        console.error(`[Analytics] Failed to log ${logItems.length} items for Run ${runId}:`, error);
    }
}

/**
 * Generates GraphQL query fields for products based on the task configuration.
 */
function getProductQueryFields(fieldToEdit: string, config: any, isBulk = false) {
    let queryFields = `
        id
        title
        featuredImage { url }
    `;

    if (fieldToEdit === 'tags' || config.addTags || config.removeTags) {
        queryFields += ' tags';
    }
    if (fieldToEdit === 'status') queryFields += ' status';
    if (fieldToEdit === 'vendor') queryFields += ' vendor';
    if (fieldToEdit === 'product_type') queryFields += ' productType';

    const needsVariants = ['price', 'compare_price', 'cost', 'inventory', 'weight', 'requires_shipping', 'taxable'].includes(fieldToEdit) ||
        (fieldToEdit === 'metafield' && config.metafieldTargetType === 'variant') ||
        (config.applyToVariants === 'conditions');

    if (needsVariants) {
        const limitTag = isBulk ? "" : "(first: 100)";
        // Bulk API requires edges/node structure
        queryFields += `
            variants${limitTag} { 
                edges {
                    node {
                        id
                        title
                        price
                        compareAtPrice
                        inventoryQuantity
                        sku
                        taxable
                        selectedOptions { name value }
                        inventoryItem {
                            id
                            inventoryLevels${limitTag} {
                                edges {
                                    node {
                                        location { id }
                                        quantities(names: ["available"]) { name quantity }
                                    }
                                }
                            }
                            measurement {
                                weight {
                                    value
                                    unit
                                }
                            }
                            requiresShipping
                            tracked
                            ${fieldToEdit === 'cost' ? 'unitCost { amount }' : ''}
                        }
                        ${fieldToEdit === 'metafield' && config.metafieldTargetType === 'variant' ?
                `metafields(first: ${isBulk ? 100 : 10}) {
                                edges {
                                    node {
                                        namespace
                                        key
                                        value
                                        type
                                        id
                                    }
                                }
                            }` : ''}
                    }
                }
            }
         `;
    }

    if (fieldToEdit === 'metafield') {
        const limitTag = isBulk ? "(first: 100)" : "(first: 10)";
        queryFields += `
            metafields${limitTag} {
                edges {
                    node {
                        namespace
                        key
                        value
                        type
                        id
                    }
                }
            }
         `;
    }
    return queryFields;
}

/**
 * Downloads a Bulk Query result (JSONL), processes it line-by-line,
 * and starts a Bulk Mutation. This is the core of the "Bypass" for large stores.
 */
export async function processBulkQueryResult(job: any, url: string) {
    const config = job.configuration || {};
    const fieldToEdit = config.fieldToEdit || "price";
    const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);

    console.log(`[Job ${job.jobId}] Downloading Bulk Query result from ${url}...`);

    const tempFilePath = `/tmp/bulk-op-${job.jobId}.jsonl`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Failed to download result: ${response.statusText}`);

        const marketPriceLists = config.applyToMarkets ? await getMarketPriceLists(shopifyAdmin, config.selectedMarkets || []) : {};

        console.log(`[Job ${job.jobId}] Downloading stream to ${tempFilePath}...`);

        const fileStream = fs.createWriteStream(tempFilePath);
        await pipeline(Readable.fromWeb(response.body as any), fileStream);
        console.log(`[Job ${job.jobId}] Download complete. Processing file...`);

        const fileContent = await fs.promises.readFile(tempFilePath, 'utf-8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        console.log(`[Job ${job.jobId}] Read ${lines.length} lines from file.`);


        let jsonlMutationRows: any[] = [];
        let originalData: any = {};
        let previewItems: any[] = [];
        let totalCount = 0;
        let allActiveLocations: { id: string, name: string }[] = [];
        let targetLocationId = config.locationId;

        // Fetch locations for inventory updates if needed
        if (fieldToEdit === 'inventory') {
            const locRes = await shopifyAdmin.graphql(`{ locations(first: 20, query: "active:true") { nodes { id name } } } `);
            const locJson = await locRes.json() as any;
            allActiveLocations = locJson.data?.locations?.nodes || [];

            // If a specific location is selected, validate it exists in active locations
            if (targetLocationId) {
                const selectedLoc = allActiveLocations.find(l => l.id === targetLocationId);
                if (!selectedLoc) {
                    console.warn(`[Job ${job.jobId}] Selected location ${targetLocationId} not found or inactive. Falling back to primary.`);
                    targetLocationId = null;
                } else {
                    console.log(`[Job ${job.jobId}] Targeting selected location: ${selectedLoc.name}`);
                }
            }

            if (!targetLocationId && allActiveLocations.length === 0) {
                // Fallback to shop primary if connection fails or is empty
                const priRes = await shopifyAdmin.graphql(`{ shop { primaryLocation { id name } } } `);
                const priJson = await priRes.json() as any;
                if (priJson.data?.shop?.primaryLocation) {
                    allActiveLocations.push(priJson.data.shop.primaryLocation);
                }
            }

            if (!targetLocationId && allActiveLocations.length === 0) {
                throw new Error("No active or primary location found. Inventory updates require at least one location.");
            }

            if (!targetLocationId) {
                console.log(`[Job ${job.jobId}] No specific location selected. Targeting ${allActiveLocations.length} active locations.`);
            }
        }

        // Trackers for metafield creation logic
        if (fieldToEdit === 'metafield') {
            const targetType = config.metafieldTargetType || 'product';
            const namespace = config.metafieldNamespace;
            const key = config.metafieldKey;
            const type = config.metafieldType || "single_line_text_field";
            const ownerType = targetType === 'product' ? 'PRODUCT' : 'PRODUCTVARIANT';

            try {
                const checkRes = await shopifyAdmin.graphql(`
                    query CheckMetafieldDef($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
                        metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
                            nodes { id }
                        }
                    }
                `, { variables: { ownerType, namespace, key } });
                const checkData = await checkRes.json() as any;
                if (!checkData?.data?.metafieldDefinitions?.nodes?.length) {
                    await shopifyAdmin.graphql(`
                        mutation CreateMetafieldDef($definition: MetafieldDefinitionInput!) {
                            metafieldDefinitionCreate(definition: $definition) {
                                userErrors { message }
                            }
                        }
                    `, {
                        variables: {
                            definition: {
                                name: `${namespace}.${key}`,
                                namespace,
                                key,
                                ownerType,
                                type,
                                access: { storefront: "PUBLIC_READ", admin: "MERCHANT_READ_WRITE" }
                            }
                        }
                    });
                    console.log(`[Job ${job.jobId}] Auto-created metafield definition ${namespace}.${key} with API access`);
                }
            } catch (e) {
                console.error(`[Job ${job.jobId}] Metafield definition sync failed:`, e);
            }
        }

        const metafieldOwners = new Set<string>();
        const allPotentialOwners = new Map<string, { title: string, image: string | null }>();

        // We need to keep track of the "current" product because variants follow it
        let currentProduct: any = null;
        let manualMetafieldDeleteRows: string[] = []; // ID
        let manualInventoryRows: { inventoryItemId: string, quantity: number, locationIds: string[] }[] = [];
        const variantIdToCalculatedQty = new Map<string, number>();
        const itemToVariant = new Map<string, string>();
        const itemToLocations = new Map<string, string[]>();
        const itemToTracked = new Map<string, boolean>();
        const itemToLocationQty = new Map<string, Map<string, number>>();

        // Pre-process for inventory data (Bulk API connection lines are separate)
        if (fieldToEdit === 'inventory') {
            for (const line of lines) {
                try {
                    const raw = JSON.parse(line);
                    if (raw.location?.id && raw.__parentId && raw.quantities) {
                        const itemId = raw.__parentId;
                        const locId = raw.location.id.split('/').pop()?.split('?')[0] || raw.location.id;
                        const qty = raw.quantities[0]?.quantity || 0;
                        if (!itemToLocationQty.has(itemId)) itemToLocationQty.set(itemId, new Map());
                        itemToLocationQty.get(itemId)!.set(locId, qty);
                    }
                } catch (e) { }
            }
        }

        // Wrap stream processing in a timeout race to prevent infinite hangs
        const processStream = async () => {
            console.log(`[Job ${job.jobId}] Stream processing started.`);
            for (const line of lines) {
                const raw = JSON.parse(line);

                // Row identification based on common IDs and structure in Shopify Bulk API
                if (raw.id?.includes("InventoryItem")) {
                    if (raw.__parentId) itemToVariant.set(raw.id, raw.__parentId);
                    if (raw.tracked !== undefined) itemToTracked.set(raw.id, raw.tracked);
                    continue;
                }

                if (raw.location?.id && raw.__parentId) {
                    // This is an InventoryLevel line processed in pre-pass above
                    continue;
                }

                if (!raw.__parentId) {
                    // It's a product
                    currentProduct = raw;
                    // ... (rest of logic) ...
                    if (['status', 'tags', 'vendor', 'product_type'].includes(fieldToEdit) || config.addTags || config.removeTags) {
                        const update: any = { id: raw.id };
                        let changed = false;

                        if (fieldToEdit === 'status') {
                            update.status = config.editValue.toUpperCase();
                            changed = true;
                        } else if (fieldToEdit === 'tags') {
                            let newTags = [...(raw.tags || [])];
                            if (config.addTags && config.tagsToAdd) {
                                const add = config.tagsToAdd.split(",").map((t: string) => t.trim()).filter(Boolean);
                                newTags = Array.from(new Set([...newTags, ...add]));
                            }
                            if (config.removeTags && config.tagsToRemove) {
                                const remove = config.tagsToRemove.split(",").map((t: string) => t.trim()).filter(Boolean);
                                newTags = newTags.filter((t: string) => !remove.includes(t));
                            }
                            if (config.editMethod === 'add_tags' && config.editValue) {
                                const add = config.editValue.split(",").map((t: string) => t.trim()).filter(Boolean);
                                newTags = Array.from(new Set([...newTags, ...add]));
                            } else if (config.editMethod === 'remove_tags' && config.editValue) {
                                const remove = config.editValue.split(",").map((t: string) => t.trim()).filter(Boolean);
                                newTags = newTags.filter((t: string) => !remove.includes(t));
                            } else if ((config.editMethod === 'replace_tags' || config.editMethod === 'fixed') && config.editValue !== undefined) {
                                newTags = config.editValue.split(",").map((t: string) => t.trim()).filter(Boolean);
                            }
                            update.tags = newTags;
                            changed = true;
                        }

                        if (config.addTags || config.removeTags) {
                            let tags = update.tags || [...(raw.tags || [])];
                            if (config.addTags) {
                                const add = config.tagsToAdd.split(",").map((t: string) => t.trim()).filter(Boolean);
                                tags = Array.from(new Set([...tags, ...add]));
                            }
                            if (config.removeTags) {
                                const remove = config.tagsToRemove.split(",").map((t: string) => t.trim()).filter(Boolean);
                                tags = tags.filter((t: string) => !remove.includes(t));
                            }
                            update.tags = tags;
                            changed = true;
                        }

                        if (changed) {
                            jsonlMutationRows.push({ input: update });
                            totalCount++;
                            if (!originalData[raw.id]) originalData[raw.id] = {};
                            if (raw.status !== undefined) originalData[raw.id].status = raw.status;
                            if (raw.tags !== undefined) originalData[raw.id].tags = raw.tags || [];
                            if (raw.vendor !== undefined) originalData[raw.id].vendor = raw.vendor;
                            if (raw.productType !== undefined) originalData[raw.id].productType = raw.productType;
                            originalData[raw.id].title = raw.title;
                            originalData[raw.id].image = raw.featuredImage?.url;

                            if (previewItems.length < 50 && fieldToEdit === 'status') {
                                previewItems.push({
                                    _v: 2,
                                    isProductUpdate: true,
                                    title: raw.title,
                                    image: raw.featuredImage?.url || null,
                                    original: raw.status,
                                    updated: update.status,
                                    status: 'pending'
                                });
                            }
                        }

                        if (fieldToEdit === 'vendor' || fieldToEdit === 'product_type') {
                            const originalVal = fieldToEdit === 'vendor' ? raw.vendor : raw.productType;
                            const inputs = {
                                value: config.editValue,
                                findText: config.findText,
                                replaceText: config.replaceText,
                                prefixValue: config.editValue,
                                suffixValue: config.editValue
                            };
                            const newVal = applyTextEdit(originalVal, config.editMethod, inputs);

                            if (newVal !== originalVal || config.editMethod.startsWith('clear_')) {
                                const updateObj: any = { id: raw.id };
                                if (fieldToEdit === 'vendor') updateObj.vendor = newVal;
                                else updateObj.productType = newVal;

                                jsonlMutationRows.push({ input: updateObj });
                                totalCount++;

                                if (!originalData[raw.id]) originalData[raw.id] = {};
                                originalData[raw.id].vendor = raw.vendor;
                                originalData[raw.id].productType = raw.productType;
                                originalData[raw.id].title = raw.title;
                                originalData[raw.id].image = raw.featuredImage?.url;

                                if (previewItems.length < 50) {
                                    previewItems.push({
                                        isProductUpdate: true,
                                        title: raw.title,
                                        image: raw.featuredImage?.url,
                                        original: originalVal,
                                        updated: newVal,
                                        status: 'pending'
                                    });
                                }
                            }
                        }
                    }

                    // Track potential metafield owners
                    if (fieldToEdit === 'metafield' && config.metafieldTargetType === 'product') {
                        allPotentialOwners.set(raw.id, {
                            title: raw.title,
                            image: raw.featuredImage?.url || null
                        });
                    }
                } else {
                    // It's a child (Variant or Metafield)
                    if (raw.id?.includes("ProductVariant")) {
                        if (fieldToEdit === 'metafield' && config.metafieldTargetType === 'variant') {
                            allPotentialOwners.set(raw.id, {
                                title: `${currentProduct?.title || "Product"} - ${raw.title}`,
                                image: currentProduct?.featuredImage?.url || null
                            });
                        }

                        const variantForEngine = {
                            ...raw,
                            inventoryItem: raw.inventoryItem || {},
                            cost: raw.inventoryItem?.unitCost?.amount,
                            weight: raw.inventoryItem?.measurement?.weight?.value,
                            weightUnit: raw.inventoryItem?.measurement?.weight?.unit,
                            requiresShipping: raw.inventoryItem?.requiresShipping,
                            taxable: raw.taxable
                        };

                        let effectiveLocationId = targetLocationId;
                        if (fieldToEdit === 'inventory') {
                            const itemId = raw.inventoryItem?.id;
                            const itemStats = itemToLocationQty.get(itemId);
                            const isTracked = itemToTracked.get(itemId);

                            if (variantForEngine.inventoryItem) {
                                variantForEngine.inventoryItem.tracked = isTracked;
                            }

                            // Priority: Explicit target > First available in map > 0
                            const rawTargetId = targetLocationId || (itemStats ? Array.from(itemStats.keys())[0] : null);
                            const normalizedTargetId = rawTargetId?.split('/').pop()?.split('?')[0] || rawTargetId;

                            if (normalizedTargetId && itemStats) {
                                variantForEngine.inventoryQuantity = itemStats.get(normalizedTargetId) || 0;
                                effectiveLocationId = rawTargetId;
                            } else {
                                variantForEngine.inventoryQuantity = 0;
                            }
                        }

                        const result = applyRulesToVariant(variantForEngine, config);

                        if (result.updatedValue !== result.originalValue || result.updatedCompareAt !== result.originalCompareAt) {
                            const mutationInput: any = { id: raw.id, productId: currentProduct?.id };

                            if (config.applyToMarkets && ['price', 'compare_price'].includes(fieldToEdit) && Object.keys(marketPriceLists).length > 0) {
                                for (const [mHandle, mInfo] of Object.entries(marketPriceLists)) {
                                    const mInfoTyped = mInfo as { priceListId: string, currency: string };
                                    jsonlMutationRows.push({
                                        priceListId: mInfoTyped.priceListId,
                                        variantId: raw.id,
                                        price: fieldToEdit === 'price' ? result.updatedPrice : raw.price,
                                        compareAtPrice: fieldToEdit === 'price' ? result.updatedCompareAt : (fieldToEdit === 'compare_price' ? result.updatedValue : raw.compareAtPrice)
                                    });
                                    totalCount++;
                                }
                            }

                            if (!config.applyToMarkets || config.applyToBasePrice !== false) {
                                if (result.updatedValue === "Not tracked") {
                                    // Skip mutation for untracked inventory
                                } else if (fieldToEdit === 'price') {
                                    mutationInput.price = result.updatedPrice;
                                    if (result.updatedCompareAt !== undefined) mutationInput.compareAtPrice = result.updatedCompareAt;
                                } else if (fieldToEdit === 'compare_price') {
                                    mutationInput.compareAtPrice = result.updatedValue;
                                } else if (fieldToEdit === 'inventory') {
                                    if (!raw.inventoryItem?.id) {
                                        console.warn(`[Job ${job.jobId}] Variant ${raw.id} is missing inventoryItemId!`);
                                    }

                                    manualInventoryRows.push({
                                        inventoryItemId: raw.inventoryItem?.id,
                                        quantity: result.updatedInventory,
                                        locationIds: effectiveLocationId ? [effectiveLocationId] : []
                                    });

                                    variantIdToCalculatedQty.set(raw.id, result.updatedInventory);
                                } else if (fieldToEdit === 'cost') {
                                    mutationInput.inventoryItemId = raw.inventoryItem?.id;
                                    mutationInput.cost = result.updatedValue;
                                } else if (fieldToEdit === 'requires_shipping') {
                                    mutationInput.inventoryItem = { requiresShipping: result.updatedValue === "Yes" };
                                } else if (fieldToEdit === 'taxable') {
                                    mutationInput.taxable = result.updatedValue === "Yes";
                                } else if (fieldToEdit === 'weight') {
                                    const unitMap: any = { "kg": "KILOGRAMS", "g": "GRAMS", "lb": "POUNDS", "oz": "OUNCES" };
                                    const targetUnit = unitMap[config.weightUnit] || "KILOGRAMS";
                                    mutationInput.inventoryItem = {
                                        measurement: { weight: { value: result.updatedWeight, unit: targetUnit } }
                                    };
                                }
                                if (fieldToEdit !== 'inventory') {
                                    jsonlMutationRows.push({ input: mutationInput });
                                }
                                totalCount++;
                            }

                            originalData[raw.id] = {
                                productId: currentProduct?.id,
                                price: result.originalPrice,
                                compareAtPrice: result.originalCompareAt,
                                inventoryQuantity: variantForEngine.inventoryQuantity,
                                locationId: effectiveLocationId,
                                inventoryItemId: raw.inventoryItem?.id,
                                cost: raw.inventoryItem?.unitCost?.amount,
                                weight: raw.inventoryItem?.measurement?.weight?.value,
                                weightUnit: raw.inventoryItem?.measurement?.weight?.unit,
                                requiresShipping: raw.inventoryItem?.requiresShipping,
                                taxable: raw.taxable,
                                sku: raw.sku,
                                title: raw.title
                            };

                            if (previewItems.length < 50 && fieldToEdit !== 'tags') {
                                previewItems.push({
                                    _v: 2,
                                    title: `${currentProduct?.title || "Product"} - ${raw.title}`,
                                    image: currentProduct?.featuredImage?.url || null,
                                    original: result.originalValue,
                                    updated: result.updatedValue,
                                    status: 'pending'
                                });
                            }
                        }
                    }

                    if (fieldToEdit === 'metafield' && raw.id?.includes("Metafield")) {
                        const namespace = config.metafieldNamespace;
                        const key = config.metafieldKey;

                        if (raw.namespace === namespace && raw.key === key) {
                            const existingValue = raw.value;
                            const editMethod = config.editMethod;
                            const editValue = config.editValue;

                            let newValue = editValue;
                            if (editMethod === 'clear_value') newValue = null;
                            else if (editMethod === 'fixed') newValue = editValue;
                            else if (editMethod === 'append_text') newValue = (existingValue || "") + editValue;
                            else if (editMethod === 'replace_text') newValue = editValue;
                            else if (editMethod === 'increase_number' || editMethod === 'decrease_number') {
                                const current = parseFloat(existingValue) || 0;
                                const change = parseFloat(editValue) || 0;
                                newValue = (editMethod === 'increase_number' ? current + change : current - change).toString();
                            } else if (editMethod === 'toggle_boolean') {
                                newValue = (existingValue !== 'true').toString();
                            }

                            if (newValue !== existingValue) {
                                if (editMethod === 'clear_value') {
                                    manualMetafieldDeleteRows.push(raw.id);
                                } else {
                                    jsonlMutationRows.push({
                                        metafieldId: raw.id,
                                        input: {
                                            ownerId: raw.__parentId,
                                            value: newValue,
                                            type: raw.type
                                        }
                                    });
                                }
                                metafieldOwners.add(raw.__parentId);
                                totalCount++;

                                // Store original data in format expected by revert logic
                                originalData[raw.__parentId] = originalData[raw.__parentId] || {};
                                originalData[raw.__parentId].metafield = {
                                    id: raw.id,
                                    namespace,
                                    key,
                                    value: existingValue,
                                    type: raw.type
                                };

                                if (previewItems.length < 50) {
                                    previewItems.push({
                                        _v: 2,
                                        isProductUpdate: true,
                                        title: `${currentProduct?.title || "Product"} (Metafield: ${namespace}.${key})`,
                                        image: currentProduct?.featuredImage?.url || null,
                                        original: existingValue,
                                        updated: newValue,
                                        status: 'pending'
                                    });
                                }
                            }
                        }
                    }
                }
            }
        };

        const processingTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Stream processing timed out after 5 minutes")), 300000)
        );

        await Promise.race([processStream(), processingTimeout]);

        console.log(`[Job ${job.jobId}] Streaming complete. Generated ${jsonlMutationRows.length} updates. Metafield Owners: ${metafieldOwners.size}`);

        if (fieldToEdit === 'metafield') {
            const namespace = config.metafieldNamespace;
            const key = config.metafieldKey;
            const type = config.metafieldType || "single_line_text_field";
            const editMethod = config.editMethod;
            const editValue = config.editValue;

            for (const [ownerId, data] of allPotentialOwners.entries()) {
                if (!metafieldOwners.has(ownerId)) {
                    let newValue = editValue;
                    if (editMethod === 'clear_value') continue;
                    else if (editMethod === 'fixed') newValue = editValue;
                    else if (editMethod === 'append_text' || editMethod === 'prepend_text') newValue = editValue;
                    else if (editMethod === 'increase_number' || editMethod === 'decrease_number') {
                        const change = parseFloat(editValue) || 0;
                        newValue = (editMethod === 'increase_number' ? change : -change).toString();
                    } else if (editMethod === 'toggle_boolean') {
                        newValue = "true";
                    }

                    if (newValue !== null) {
                        jsonlMutationRows.push({
                            input: { ownerId, value: newValue, type }
                        });
                        totalCount++;
                        // Store original data in format expected by revert logic (new metafields have null original value)
                        originalData[ownerId] = originalData[ownerId] || {};
                        originalData[ownerId].metafield = { id: null, namespace, key, value: null, type };
                        if (previewItems.length < 50) {
                            previewItems.push({
                                _v: 2,
                                isProductUpdate: true,
                                title: `${data.title} (New Metafield: ${namespace}.${key})`,
                                image: data.image,
                                original: null,
                                updated: newValue,
                                status: 'pending'
                            });
                        }
                    }
                }
            }
        }

        console.log(`[Job ${job.jobId}] Streaming complete. Generated ${jsonlMutationRows.length} updates.`);

        // Reconcile inventory locations
        if (fieldToEdit === 'inventory') {
            for (const [itemId, varId] of itemToVariant.entries()) {
                const qty = variantIdToCalculatedQty.get(varId);
                const tracked = itemToTracked.get(itemId);

                if (qty !== undefined && tracked !== false) {
                    manualInventoryRows.push({
                        inventoryItemId: itemId,
                        quantity: qty,
                        locationIds: itemToLocations.get(itemId) || []
                    });
                }
            }
            const variantsWithNoLocations = manualInventoryRows.filter((r: any) => r.locationIds.length === 0);
            console.log(`[Job ${job.jobId}] Reconciled ${manualInventoryRows.length} inventory rows from ${itemToVariant.size} items. ${variantsWithNoLocations.length} variants have no stocked locations.`);
        }


        const marketRows = jsonlMutationRows.filter(r => r.priceListId);
        const standardRows = jsonlMutationRows.filter(r => !r.priceListId);

        let mutation = "";
        let finalRows: any[] = [];
        let manualMarketRows: any[] = marketRows;
        let manualProductUpdateRows: any[] = [];

        if (jsonlMutationRows.length > 0 || manualMetafieldDeleteRows.length > 0 || manualInventoryRows.length > 0) {

            if (standardRows.length > 0) {
                if (['price', 'compare_price', 'weight', 'requires_shipping', 'taxable'].includes(fieldToEdit)) {
                    const variantRows = standardRows.filter(r => r.input?.id?.includes("ProductVariant"));
                    const productRows = standardRows.filter(r => r.input?.id?.includes("Product/"));
                    manualProductUpdateRows = productRows;

                    const byProduct: Record<string, any[]> = {};
                    variantRows.forEach(r => {
                        const pid = r.input.productId;
                        if (!pid) return;
                        if (!byProduct[pid]) byProduct[pid] = [];
                        const variantInput: any = { id: r.input.id };
                        if (r.input.price !== undefined) variantInput.price = r.input.price;
                        if (r.input.compareAtPrice !== undefined) variantInput.compareAtPrice = r.input.compareAtPrice;
                        if (r.input.inventoryItem !== undefined) variantInput.inventoryItem = r.input.inventoryItem;
                        if (r.input.taxable !== undefined) variantInput.taxable = r.input.taxable;
                        byProduct[pid].push(variantInput);
                    });

                    if (Object.keys(byProduct).length > 0) {
                        mutation = `mutation bulkUpdateStreaming($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                                product { id }
                                productVariants { id }
                                userErrors { field message }
                            }
                        }`;
                        finalRows = Object.entries(byProduct).map(([productId, variants]) => ({ productId, variants }));
                    }
                } else if (['status', 'tags', 'vendor', 'product_type'].includes(fieldToEdit)) {
                    mutation = `mutation($input: ProductInput!) {
                        productUpdate(input: $input) {
                            product { id }
                            userErrors { field message }
                        }
                    }`;
                    finalRows = standardRows;
                } else if (fieldToEdit === 'inventory') {
                    // inventorySetQuantities is not supported in bulk mutations.
                    // Updates utilize manualInventoryRows and are processed manually below.
                    mutation = "";
                    finalRows = [];
                } else if (fieldToEdit === 'cost') {
                    mutation = `mutation($id: ID!, $input: InventoryItemInput!) {
                        inventoryItemUpdate(id: $id, input: $input) {
                            inventoryItem { id }
                            userErrors { field message }
                        }
                    }`;
                    finalRows = standardRows.map(r => ({ id: r.input.inventoryItemId, input: { cost: r.input.cost } }));
                } else if (fieldToEdit === 'metafield') {
                    if (config.editMethod === 'clear_value') {
                        // Deletions utilize manualMetafieldDeleteRows and are processed manually below
                        mutation = "";
                        finalRows = [];
                    } else {
                        mutation = `mutation bulkSetMetafields($input: MetafieldsSetInput!) {
                                metafieldsSet(metafields: [$input]) {
                                    metafields { id }
                                    userErrors { field message }
                                }
                            }`;
                        finalRows = standardRows.map(r => ({
                            input: {
                                ownerId: r.input.ownerId,
                                namespace: config.metafieldNamespace,
                                key: config.metafieldKey,
                                value: r.input.value,
                                type: r.input.type || "single_line_text_field"
                            }
                        }));
                    }
                }
            } else if (marketRows.length > 0) {
                mutation = `mutation($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
                    priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
                        userErrors { field message }
                    }
                }`;
                finalRows = marketRows.map(row => ({
                    priceListId: row.priceListId,
                    prices: [{
                        variantId: row.variantId,
                        price: Number(row.price),
                        compareAtPrice: row.compareAtPrice !== null && row.compareAtPrice !== undefined ? Number(row.compareAtPrice) : null
                    }]
                }));
            }

            console.log(`[Job ${job.jobId}] Generated ${finalRows.length} rows for mutation.`);

            if (mutation && finalRows.length > 0) {
                console.log(`[Job ${job.jobId}] Creating Staged Upload...`);
                const target = await createStagedUpload(job.shopDomain, `bulk_mutation_${job.jobId}.jsonl`);

                const jsonlContent = finalRows.map(r => JSON.stringify(r)).join("\n");
                console.log(`[Job ${job.jobId}] Uploading JSONL (${jsonlContent.length} bytes)...`);
                const resourceUrl = await uploadJsonl(target, jsonlContent);

                console.log(`[Job ${job.jobId}] Running Bulk Mutation...`);
                const operation = await runBulkMutation(job.shopDomain, mutation, resourceUrl);
                console.log(`[Job ${job.jobId}] Bulk Mutation started: ${operation.id}`);

                await prisma.priceJob.update({
                    where: { jobId: job.jobId },
                    data: { status: "processing", totalProducts: totalCount, previewJson: previewItems, originalData: originalData, note: `BULK_MUTATION_ID:${operation.id}` }
                });
            } else {
                console.log(`[Job ${job.jobId}] No mutations to run.`);
                await prisma.priceJob.update({
                    where: { jobId: job.jobId },
                    data: { status: "processing", totalProducts: totalCount, previewJson: previewItems, originalData: originalData }
                });
            }

            if (manualProductUpdateRows.length > 0) {
                for (const r of manualProductUpdateRows) {
                    try {
                        await shopifyAdmin.graphql(`mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }`, { variables: { input: r.input } });
                    } catch (e) { console.error(`Manual product update failed`, e); }
                }
            }

            if (manualMarketRows.length > 0) {
                const byPriceList: Record<string, any[]> = {};
                for (const u of manualMarketRows) {
                    if (!byPriceList[u.priceListId]) byPriceList[u.priceListId] = [];
                    byPriceList[u.priceListId].push({ variantId: u.variantId, price: Number(u.price), compareAtPrice: u.compareAtPrice !== null && u.compareAtPrice !== undefined ? Number(u.compareAtPrice) : null });
                }
                for (const [priceListId, prices] of Object.entries(byPriceList)) {
                    const BATCH_SIZE = 200;
                    for (let i = 0; i < prices.length; i += BATCH_SIZE) {
                        const chunk = prices.slice(i, i + BATCH_SIZE);
                        try { await shopifyAdmin.graphql(`mutation priceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) { priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) { userErrors { field message } } }`, { variables: { priceListId, prices: chunk } }); }
                        catch (e) { console.error(`Manual market update failed`, e); }
                    }
                }
            }

            if (manualMetafieldDeleteRows.length > 0) {
                console.log(`[Job ${job.jobId}] Processing ${manualMetafieldDeleteRows.length} manual metafield deletions...`);
                console.log(`[Job ${job.jobId}] Metafield IDs to delete:`, manualMetafieldDeleteRows);
                // Reduce batch size for metafields due to higher query costs
                const BATCH_SIZE = fieldToEdit === 'metafield' ? 5 : 10;
                for (let i = 0; i < manualMetafieldDeleteRows.length; i += BATCH_SIZE) {
                    const chunk = manualMetafieldDeleteRows.slice(i, i + BATCH_SIZE);
                    const deleteResults = await Promise.all(chunk.map(async id => {
                        console.log(`[Job ${job.jobId}] Deleting metafield: ${id}`);
                        try {
                            const res = await shopifyAdmin.graphql(
                                `mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) { 
                                    metafieldsDelete(metafields: $metafields) { 
                                        deletedMetafields { ownerId namespace key } 
                                        userErrors { field message } 
                                    } 
                                }`,
                                { variables: { metafields: [{ id }] } }
                            );
                            const json = await res.json() as any;
                            console.log(`[Job ${job.jobId}] Metafield delete response for ${id}:`, JSON.stringify(json, null, 2));

                            if (json.data?.metafieldsDelete?.userErrors?.length > 0) {
                                console.error(`[Job ${job.jobId}] Metafield delete errors for ${id}:`, json.data.metafieldsDelete.userErrors);
                            } else if (json.data?.metafieldsDelete?.deletedMetafields) {
                                console.log(`[Job ${job.jobId}] Successfully deleted metafield: ${id}`);
                            }
                            return json;
                        } catch (e) {
                            console.error(`[Job ${job.jobId}] Failed to delete metafield ${id}`, e);
                            return null;
                        }
                    }));
                }
            }

            if (manualInventoryRows.length > 0) {
                console.log(`[Job ${job.jobId}] Processing ${manualInventoryRows.length} manual inventory updates...`);

                // Flatten all planned updates into a single list of (inventoryItemId, locationId, quantity) tuples
                const allPlannedQuantities: any[] = [];
                manualInventoryRows.forEach(r => {
                    const activeLocId = targetLocationId || allActiveLocations[0]?.id;
                    const itemLocId = r.locationIds?.[0]; // If we want to restrict to where item already is?
                    // For now, let's use the explicit target if set, otherwise fallback
                    const targetId = targetLocationId || itemLocId || activeLocId;

                    if (!targetId) {
                        console.warn(`[Job ${job.jobId}] Item ${r.inventoryItemId} has no target location ID! Skipping.`);
                        return;
                    }

                    allPlannedQuantities.push({
                        inventoryItemId: r.inventoryItemId,
                        locationId: targetId,
                        quantity: r.quantity
                    });
                });

                console.log(`[Job ${job.jobId}] Generated ${allPlannedQuantities.length} location-specific quantity updates.`);

                const MUTATION_BATCH_SIZE = 250;
                let allUserErrors: any[] = [];

                for (let i = 0; i < allPlannedQuantities.length; i += MUTATION_BATCH_SIZE) {
                    const chunk = allPlannedQuantities.slice(i, i + MUTATION_BATCH_SIZE);

                    try {
                        console.log(`[Job ${job.jobId}] Sending Inventory Batch:`, JSON.stringify(chunk.slice(0, 2))); // Log first 2 items of batch
                        const res = await shopifyAdmin.graphql(`
                            mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
                                inventorySetQuantities(input: $input) {
                                    inventoryAdjustmentGroup { id }
                                    userErrors { field message }
                                }
                            }
                        `, {
                            variables: {
                                input: {
                                    name: "available",
                                    reason: "correction",
                                    ignoreCompareQuantity: true,
                                    quantities: chunk
                                }
                            }
                        });
                        const data = await res.json() as any;
                        const errors = data.data?.inventorySetQuantities?.userErrors || [];

                        if (errors.length > 0) {
                            console.error(`[Job ${job.jobId}] Inventory batch has userErrors:`, JSON.stringify(errors));
                            allUserErrors.push(...errors);
                        } else {
                            console.log(`[Job ${job.jobId}] Inventory batch processed ${chunk.length} items. Result Group:`, data.data?.inventorySetQuantities?.inventoryAdjustmentGroup?.id || "None");
                        }
                    } catch (e) {
                        console.error(`[Job ${job.jobId}] Manual inventory update batch fatal error`, e);
                        allUserErrors.push({ field: ["batch"], message: String(e) });
                    }
                }

                if (allUserErrors.length > 0) {
                    const detailedError = allUserErrors.map(e => `${e.field || 'General'}: ${e.message}`).join('; ');
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: {
                            status: "failed",
                            error: `Inventory updates failed: ${detailedError.substring(0, 500)}${detailedError.length > 500 ? '...' : ''}`
                        }
                    });
                    return;
                }
            }

            if (!(mutation && finalRows.length > 0)) {
                await prisma.priceJob.update({
                    where: { jobId: job.jobId },
                    data: { status: "completed", completedAt: new Date(), processedProducts: totalCount }
                });
            }
        } else {
            await prisma.priceJob.update({
                where: { jobId: job.jobId },
                data: { status: "completed", completedAt: new Date(), processedProducts: 0 }
            });
        }
    } catch (err) {
        console.error(`[Job ${job.jobId}] processBulkQueryResult failed:`, err);
        await prisma.priceJob.update({
            where: { jobId: job.jobId },
            data: { status: "failed", error: String(err) }
        });
    } finally {
        // Cleanup temp file
        if (fs.existsSync(tempFilePath)) {
            fs.unlink(tempFilePath, (err) => {
                if (err) console.error(`[Job ${job.jobId}] Failed to cleanup temp file:`, err);
            });
        }
    }
}

export async function runJob(job: any) {
    let shopCurrency = "$";
    let config = job.configuration || {};
    let runId: string | null = null;
    let updatedCount = 0;
    let failedCount = 0;

    // Fetch Location ID for Inventory Jobs (Hoisted for scope access)
    let primaryLocationId: string | null = null;
    if (config && (config as any).fieldToEdit === 'inventory') {
        try {
            const shopifyAdminForLoc = await getAuthenticatedAdmin(job.shopDomain);
            const locRes = await shopifyAdminForLoc.graphql(`{ locations(first: 5) { nodes { id isActive } } }`);
            const locData = await locRes.json() as any;
            const activeLoc = locData.data?.locations?.nodes?.find((l: any) => l.isActive);
            if (activeLoc) {
                primaryLocationId = activeLoc.id;
                console.log(`[Job ${job.jobId}] Using Location ID: ${primaryLocationId}`);
            } else {
                console.error(`[Job ${job.jobId}] No active location found for inventory update!`);
            }
        } catch (e) {
            console.error(`[Job ${job.jobId}] Failed to fetch location ID:`, e);
        }
    }

    try {
        // Create Task Run record
        const runData = await prisma.taskRun.create({
            data: {
                jobId: job.jobId,
                shop: job.shopDomain,
                startedAt: new Date(),
                status: 'running',
                totalProducts: job.totalProducts || 0,
                updatedProducts: 0,
                failedProducts: 0
            }
        });

        if (runData) {
            runId = runData.id;
        }

        // Attempt to claim the job and transition to calculating phase
        const claim = await prisma.priceJob.updateMany({
            where: {
                jobId: job.jobId,
                status: "scheduled"
            },
            data: { status: "calculating" }
        });

        if (claim.count === 0) {
            console.log(`[Job ${job.jobId}] Job already claimed or status changed. Skipping runJob execution.`);
            return;
        }

        // Phase 1: Calculation
        console.log(`Starting job ${job.jobId}: Calculation phase`);

        try {
            const shopifyAdminForCurrency = await getAuthenticatedAdmin(job.shopDomain);
            const shopRes = await shopifyAdminForCurrency.graphql(`{ shop { currencyCode } }`);
            const shopData = await shopRes.json() as any;
            const currencyCode = shopData.data?.shop?.currencyCode || "USD";
            const currencySymbols: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
            shopCurrency = currencySymbols[currencyCode] || currencySymbols["USD"];
        } catch (e) {
            console.error("Failed to fetch shop currency for email:", e);
        }



        const shopifyAdminForJob = await getAuthenticatedAdmin(job.shopDomain);
        const marketPriceLists = config.applyToMarkets ? await getMarketPriceLists(shopifyAdminForJob, config.selectedMarkets || []) : {};
        if (config.applyToMarkets) {
            console.log(`[Job ${job.jobId}] Found ${Object.keys(marketPriceLists).length} market price lists for update.`);
        }
        const fieldToEdit = config.fieldToEdit || "price";
        const editMethod = config.editMethod || "fixed";
        const editValue = config.editValue || "0";
        const compareAtPriceOption = config.compareAtPriceOption || "none";
        const compareAtEditMethod = config.compareAtEditMethod || "fixed";
        const compareAtEditValue = config.compareAtEditValue || "0";
        const rounding = config.rounding || "none";
        const roundingValue = config.roundingValue; // Get custom rounding value
        const excludedProducts = config.excludedProductsList || [];
        const excludedIds = new Set(excludedProducts.map((p: any) => p.id));

        // Get Shopify Admin
        const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);

        // Construct Query
        let searchQuery = "";
        const applyToProducts = config.applyToProducts || "all";

        if (applyToProducts === "specific") {
            const ids = (config.selectedProducts || []).map((p: any) => p.id.split("/").pop()).join(" OR ");
            if (ids) searchQuery = `id:${ids} `;
        }
        else if (applyToProducts === "collections" && config.selectedCollections?.length > 0) {
            const queryParts = config.selectedCollections.map((c: any) => `collection_id:${c.id.split("/").pop()} `);
            searchQuery = queryParts.join(" OR ");
        } else if (applyToProducts === "conditions" && config.productConditions?.length > 0) {
            const parts = config.productConditions.map((c: any) => {
                if (!c.value) return null;
                let field = c.property;
                if (field === "title") field = "title";
                if (field === "status") field = "status";
                if (field === "handle") field = "handle";
                if (field === "collection") field = "collection_id";
                if (field === "tag") field = "tag";
                if (field === "type") field = "product_type";
                if (field === "vendor") field = "vendor";
                if (field === "created_at") field = "created_at";
                if (field === "updated_at") field = "updated_at";
                if (field === "metafield") {
                    if (c.metafieldKey) {
                        field = `metafields.${c.metafieldKey}`;
                    } else if (c.metafieldNamespace && c.originalKey) {
                        field = `metafields.${c.metafieldNamespace}.${c.originalKey}`;
                    } else {
                        // Invalid metafield condition
                        return null;
                    }
                }

                let value = c.value;
                if (field === "status") value = value.toLowerCase();
                let op = ":";

                if (c.operator === "contains") {
                    return `(${field}:*${value}* OR ${field}:"${value}")`;
                }

                if (c.operator === "starts_with") {
                    value = `${value}*`;
                } else if (c.operator === "ends_with") {
                    value = `*${value}`;
                } else if (c.operator === "greater_than") {
                    op = ":>";
                } else if (c.operator === "less_than") {
                    op = ":<";
                }

                if (c.operator === "equals" || field === "status" || field === "collection_id" || field === "id") {
                    op = ":";
                    if (field === "status" || field === "id") {
                        value = c.value.toLowerCase();
                    }
                }

                return `(${field}${op}${value})`;
            }).filter(Boolean);

            if (parts.length > 0) {
                // Default to 'all' (AND) if undefined
                const logic = config.productMatchLogic || 'all';
                const joiner = logic === "any" ? " OR " : " AND ";
                searchQuery = parts.join(joiner);
            } else if (config.productConditions && config.productConditions.length > 0) {
                // Logic: If user provided conditions but they were all invalid/filtered out (e.g. missing metafield key),
                // we MUST NOT fall back to empty query (which matches ALL products).
                // We should match NOTHING.
                searchQuery = "id:NONE";
            }
        }

        // Fetch Products
        let products: any[] = [];
        const queryFields = getProductQueryFields(fieldToEdit, config);

        // --- SCALABILITY BYPASS: Use Bulk Query for large catalogs (> 100 products or "all") ---
        // For metafields, use lower threshold (50) due to higher query costs
        const bulkThreshold = fieldToEdit === 'metafield' ? 50 : 100;
        const totalEstimate = job.totalProducts || (applyToProducts === 'all' ? 10001 : 0);
        if (totalEstimate > bulkThreshold) {
            console.log(`[Job ${job.jobId}] Catalog size/scope large (${totalEstimate}). Triggering Bulk Query...`);
            try {
                const bulkQuery = `
                    {
                        products(query: "${searchQuery.trim() || ""}") {
                            edges {
                                node {
                                    ${getProductQueryFields(fieldToEdit, config, true)}
                                }
                            }
                        }
                    }
                `;
                const operation = await runBulkQuery(job.shopDomain, bulkQuery);
                await prisma.priceJob.update({
                    where: { jobId: job.jobId },
                    data: {
                        status: "calculating", // We reuse calculating status
                        note: `BULK_QUERY_ID:${operation.id}`
                    }
                });
                console.log(`[Job ${job.jobId}] Bulk Query started: ${operation.id}`);
                return; // Exit and wait for poller
            } catch (bulkQueryErr: any) {
                if (bulkQueryErr.message?.includes("BULK_QUERY_IN_PROGRESS") || bulkQueryErr.message?.includes("already in progress")) {
                    console.log(`[Job ${job.jobId}] Bulk Operation already in progress in Shopify. Rescheduling for later.`);
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: {
                            status: "scheduled",
                            startTime: new Date(Date.now() + 60000) // Retry in 1 minute
                        }
                    });
                    return;
                }
                console.error(`[Job ${job.jobId}] Bulk Query fail, falling back:`, bulkQueryErr);
                // Fall through to standard pagination
            }
        }


        let hasNextPage = true;
        let cursor = null;

        console.log(`Fetching products with query: ${searchQuery} `);

        while (hasNextPage) {
            try {
                console.log(`[Job ${job.job_id}] Fetching page with cursor: ${cursor}`);
                const fetchResponse = await shopifyAdmin.graphql(
                    `query getProducts($query: String!, $cursor: String) {
                        products(query: $query, first: 10, after: $cursor) {
                            nodes {
                                id
                                title
                                featuredImage { url }
                                ${fieldToEdit === 'tags' || config.addTags || config.removeTags ? 'tags' : ''}
                                ${fieldToEdit === 'status' ? 'status' : ''}
                                ${fieldToEdit === 'vendor' ? 'vendor' : ''}
                                ${fieldToEdit === 'product_type' ? 'productType' : ''}
                                ${['price', 'compare_price', 'cost', 'inventory', 'weight', 'requires_shipping', 'taxable'].includes(fieldToEdit) || (fieldToEdit === 'metafield' && config.metafieldTargetType === 'variant') || (config.applyToVariants === 'conditions') ?
                        `variants(first: 100) { 
                                        nodes {
                                            id title price compareAtPrice inventoryQuantity sku taxable
                                            selectedOptions { name value }
                                            inventoryItem { 
                                                id 
                                                measurement { weight { value unit } }
                                                requiresShipping
                                                tracked
                                                ${fieldToEdit === 'cost' ? 'unitCost { amount }' : ''}
                                                inventoryLevels(first: 50) {
                                                    edges {
                                                        node {
                                                            location { id }
                                                            quantities(names: ["available"]) { name quantity }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }` : ''}
                                ${fieldToEdit === 'metafield' ?
                        `metafields(first: 10) {
                                        edges { node { namespace key value type id } }
                                    }` : ''}
                            }
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                        }
                    }`,
                    { variables: { query: searchQuery || "", cursor } }
                );

                const fetchJson = await fetchResponse.json() as any;
                if (fetchJson.errors) {
                    console.error("[Job Failed] GraphQL Errors for shop:", job.shop_domain, JSON.stringify(fetchJson.errors, null, 2));
                    throw new Error(`GraphQL Error: ${fetchJson.errors[0]?.message || 'Unknown error'}`);
                }

                const pageNodes = fetchJson.data?.products?.nodes || [];
                // Safety net: deduplicate products by ID 
                for (const node of pageNodes) {
                    if (!products.some((p: any) => p.id === node.id)) {
                        products.push(node);
                    }
                }

                const pageInfo = fetchJson.data?.products?.pageInfo || {};
                hasNextPage = pageInfo.hasNextPage;
                cursor = pageInfo.endCursor;
            } catch (err) {
                console.error(`[Job ${job.job_id}] Failed to fetch products page. Cursor: ${cursor}. Error:`, err);
                throw new Error(`Failed to fetch products: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        // Generate Updates & Preview
        let originalData: any = {};
        let updates: any[] = [];
        let metafieldDeletions: Array<{ ownerId: string, namespace: string, key: string }> = []; // Collect metafield identifiers for deletion
        let previewItems: any[] = [];

        for (const product of products) {
            // Skip excluded products
            if (excludedIds.has(product.id)) {
                continue;
            }

            let newVal = editValue;
            let productUpdated = false;

            // Product-level fields (Status, Tags)
            if (!originalData[product.id]) originalData[product.id] = {};
            if (product.status !== undefined) originalData[product.id].status = product.status;
            if (product.tags !== undefined) originalData[product.id].tags = [...(product.tags || [])];
            if (product.vendor !== undefined) originalData[product.id].vendor = product.vendor;
            if (product.productType !== undefined) originalData[product.id].productType = product.productType;
            originalData[product.id].title = product.title;
            originalData[product.id].image = product.featuredImage?.url;

            if (fieldToEdit === 'status' || fieldToEdit === 'tags') {

                if (fieldToEdit === 'status') {
                    const statusVal = editValue.toUpperCase();
                    updates.push({
                        id: product.id,
                        title: product.title,
                        logOriginal: product.status,
                        logNew: statusVal,
                        status: statusVal
                    });
                    newVal = statusVal;
                    productUpdated = true;
                } else {
                    // Tag logic
                    let newTags = [...product.tags];
                    if (editMethod === 'add_tags') {
                        const tagsToAdd = editValue.split(",").filter(Boolean).map((t: string) => t.trim());
                        newTags = Array.from(new Set([...newTags, ...tagsToAdd]));
                    } else if (editMethod === 'remove_tags') {
                        const tagsToRemove = editValue.split(",").filter(Boolean).map((t: string) => t.trim());
                        newTags = newTags.filter((t: string) => !tagsToRemove.includes(t));
                    } else if (editMethod === 'replace_tags') {
                        newTags = editValue.split(",").filter(Boolean).map((t: string) => t.trim());
                    }
                    updates.push({
                        id: product.id,
                        title: product.title,
                        logOriginal: product.tags.join(", "),
                        logNew: newTags.join(", "),
                        tags: newTags
                    });
                    newVal = newTags.join(", ");
                    productUpdated = true;
                }
            }

            // Capture Preview for Status/Tags
            if (productUpdated && previewItems.length < 100 && fieldToEdit === 'status') {
                const item: any = {
                    isProductUpdate: true,
                    id: product.id,
                    title: product.title,
                    image: product.featuredImage?.url,
                    original: product.status,
                    updated: newVal,
                    status: 'pending'
                };
                previewItems.push(item);
            }

            // --- VENDOR & PRODUCT TYPE UPDATE LOGIC ---
            if (fieldToEdit === 'vendor' || fieldToEdit === 'product_type') {
                const originalVal = fieldToEdit === 'vendor' ? product.vendor : product.productType;
                const inputs = {
                    value: config.editValue,
                    findText: config.findText,
                    replaceText: config.replaceText,
                    prefixValue: config.editValue,
                    suffixValue: config.editValue
                };
                const newVal = applyTextEdit(originalVal, editMethod, inputs);

                if (newVal !== originalVal || editMethod.startsWith('clear_')) {
                    const updateObj: any = {
                        id: product.id,
                        title: product.title,
                        logOriginal: originalVal,
                        logNew: newVal
                    };
                    if (fieldToEdit === 'vendor') {
                        updateObj.vendor = newVal;
                    } else {
                        updateObj.productType = newVal;
                    }

                    updates.push(updateObj);

                    if (!originalData[product.id]) originalData[product.id] = {};
                    if (fieldToEdit === 'vendor') originalData[product.id].vendor = originalVal;
                    else originalData[product.id].productType = originalVal;

                    if (previewItems.length < 100) {
                        previewItems.push({
                            _v: 2,
                            isProductUpdate: true,
                            id: product.id,
                            title: product.title,
                            image: product.featuredImage?.url || null,
                            original: originalVal,
                            updated: newVal,
                            original_price: product.variants?.nodes?.[0]?.price || null,
                            updated_price: product.variants?.nodes?.[0]?.price || null,
                            original_compare: product.variants?.nodes?.[0]?.compareAtPrice || null,
                            updated_compare: product.variants?.nodes?.[0]?.compareAtPrice || null,
                            status: 'pending'
                        });
                    }
                }
            }

            // --- METAFIELD UPDATE LOGIC ---
            if (fieldToEdit === 'metafield') {
                const targetType = config.metafieldTargetType || 'product'; // "product" or "variant"
                const namespace = config.metafieldNamespace;
                const key = config.metafieldKey;
                const type = config.metafieldType || "single_line_text_field";

                // Auto-create metafield definition with API access for new metafields
                try {
                    const ownerType = targetType === 'product' ? 'PRODUCT' : 'PRODUCTVARIANT';

                    // Check if definition exists
                    const checkDefinitionQuery = `
                        query CheckMetafieldDefinition($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
                            metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
                                nodes {
                                    id
                                    name
                                    namespace
                                    key
                                }
                            }
                        }
                    `;

                    const checkResponse = await shopifyAdmin.graphql(checkDefinitionQuery, {
                        variables: {
                            ownerType,
                            namespace,
                            key
                        }
                    });

                    const checkData = await checkResponse.json();
                    const definitionExists = checkData?.data?.metafieldDefinitions?.nodes?.length > 0;

                    // If definition doesn't exist, create it with API access
                    if (!definitionExists) {
                        const createDefinitionMutation = `
                            mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
                                metafieldDefinitionCreate(definition: $definition) {
                                    createdDefinition {
                                        id
                                        name
                                        namespace
                                        key
                                    }
                                    userErrors {
                                        field
                                        message
                                    }
                                }
                            }
                        `;

                        await shopifyAdmin.graphql(createDefinitionMutation, {
                            variables: {
                                definition: {
                                    name: `${namespace}.${key}`,
                                    namespace,
                                    key,
                                    ownerType,
                                    type,
                                    access: {
                                        storefront: "PUBLIC_READ",
                                        admin: "MERCHANT_READ_WRITE"
                                    }
                                }
                            }
                        });

                        console.log(`[METAFIELD] Auto-created definition for ${namespace}.${key} with API access enabled`);
                    }
                } catch (error) {
                    console.error(`[METAFIELD] Failed to create definition:`, error);
                    // Continue anyway - the metafield value update will still work
                }

                const targets = (targetType === 'variant' && product.variants?.nodes) ? product.variants.nodes : [product];

                for (const target of targets) {
                    // Find existing metafield
                    const existingEdge = target.metafields?.edges?.find((e: any) =>
                        e.node.namespace === namespace && e.node.key === key
                    );
                    const existingValue = existingEdge ? existingEdge.node.value : null;

                    // Capture Original Data for Revert (Product or Variant)
                    if (!originalData[target.id]) {
                        originalData[target.id] = {};
                    }
                    // Store detailed info including namespace/key to allow recreating/nulling properly
                    originalData[target.id].metafield = existingEdge ? {
                        id: existingEdge.node.id,
                        value: existingEdge.node.value,
                        type: existingEdge.node.type,
                        namespace: namespace,
                        key: key
                    } : null; // null means it didn't exist

                    // Calculate New Value
                    let newValue = existingValue;

                    if (editMethod === 'clear_value') {
                        newValue = null;
                    } else if (editMethod === 'toggle_boolean') {
                        newValue = (existingValue === 'true' ? 'false' : 'true');
                    } else if (editMethod === 'increase_number' || editMethod === 'decrease_number') {
                        const current = parseFloat(existingValue || "0") || 0;
                        const change = parseFloat(editValue || "0") || 0;
                        newValue = (editMethod === 'increase_number' ? current + change : current - change).toString();
                    } else if (editMethod === 'increase_percent' || editMethod === 'decrease_percent') {
                        const current = parseFloat(existingValue || "0") || 0;
                        const percent = parseFloat(editValue || "0") || 0;
                        newValue = (editMethod === 'increase_percent' ? current * (1 + percent / 100) : current * (1 - percent / 100)).toString();
                    } else if (editMethod === 'append_text') {
                        newValue = (existingValue || "") + editValue;
                    } else if (editMethod === 'prepend_text') {
                        newValue = editValue + (existingValue || "");
                    } else if (editMethod === 'find_replace' || editMethod === 'replace_text') {
                        const find = config.findText || "";
                        const replace = config.replaceText || "";
                        newValue = (find && existingValue !== null) ? existingValue.split(find).join(replace) : existingValue;
                    } else if (editMethod === 'to_uppercase') {
                        newValue = (existingValue || "").toUpperCase();
                    } else if (editMethod === 'to_lowercase') {
                        newValue = (existingValue || "").toLowerCase();
                    } else if (editMethod === 'to_titlecase') {
                        newValue = (existingValue || "").replace(/\w\S*/g, (txt: string) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
                    } else {
                        // Default / Fixed logic
                        newValue = editValue;
                        // Normalize boolean if applicable
                        if (type === 'boolean') {
                            newValue = (editValue === 'false' || editMethod === 'fixed_false') ? 'false' : 'true';
                        }
                    }

                    // For integers, ensure rounding
                    if (type && type?.includes('integer') && newValue !== null) {
                        const parsed = parseFloat(newValue);
                        if (!isNaN(parsed)) {
                            newValue = Math.round(parsed).toString();
                        }
                    }

                    // Handle clear_value: Don't add to updates, collect for deletion instead
                    if (newValue !== null) {
                        // Prepare update object (only for non-null values)
                        updates.push({
                            ownerId: target.id,
                            title: targetType === 'variant' ? `${product.title} - ${target.title}` : product.title,
                            logOriginal: existingValue,
                            logNew: newValue,
                            metadata: { namespace, key, type },
                            metafields: [
                                {
                                    namespace,
                                    key,
                                    type,
                                    value: newValue
                                }
                            ]
                        });
                    } else if (editMethod === 'clear_value' && existingEdge) {
                        // For clear_value, collect metafield identifier for deletion
                        if (!metafieldDeletions) metafieldDeletions = [];
                        metafieldDeletions.push({
                            ownerId: target.id,
                            namespace,
                            key
                        });
                        console.log(`[Job ${job.jobId}] Metafield clear_value: Will delete ${namespace}.${key} from ${target.id}`);
                    }

                    // Add to preview (flattened)
                    if (previewItems.length < 100) {
                        previewItems.push({
                            _v: 2,
                            isProductUpdate: true,
                            id: target.id,
                            title: targetType === 'variant' ? `${product.title} - ${target.title}` : product.title,
                            image: product.featuredImage?.url || null,
                            original: existingValue,
                            updated: newValue,
                            original_price: target.price || product.variants?.nodes?.[0]?.price || null,
                            updated_price: target.price || product.variants?.nodes?.[0]?.price || null,
                            original_compare: target.compareAtPrice || product.variants?.nodes?.[0]?.compareAtPrice || null,
                            updated_compare: target.compareAtPrice || product.variants?.nodes?.[0]?.compareAtPrice || null,
                            status: 'pending'
                        });
                    }
                }
            }

            // Handle Tags Manager as a secondary action OR Primary action
            if (fieldToEdit === 'tags' || config.addTags || config.removeTags) {
                let currentTags = [...(product.tags || [])];
                let changed = false;

                if (config.addTags && config.tagsToAdd) {
                    const toAdd = config.tagsToAdd.split(",").filter(Boolean).map((t: string) => t.trim());
                    if (toAdd.length > 0) {
                        const originalSize = currentTags.length;
                        currentTags = Array.from(new Set([...currentTags, ...toAdd]));
                        if (currentTags.length !== originalSize) changed = true;
                    }
                }

                if (config.removeTags && config.tagsToRemove) {
                    const toRemove = config.tagsToRemove.split(",").filter(Boolean).map((t: string) => t.trim());
                    if (toRemove.length > 0) {
                        const originalSize = currentTags.length;
                        currentTags = currentTags.filter((t: string) => !toRemove.includes(t));
                        if (currentTags.length !== originalSize) changed = true;
                    }
                }

                if (fieldToEdit === 'tags' && (config.editMethod === 'replace_tags' || config.editMethod === 'fixed') && config.editValue !== undefined) {
                    // Main tag replacement
                    const newTags = config.editValue.split(",").map((t: string) => t.trim()).filter(Boolean);
                    // Check if different
                    const isDifferent = JSON.stringify(newTags.sort()) !== JSON.stringify(currentTags.sort());
                    // Simple check isn't enough because order might differ but content same.
                    // But actually if I replace, I want the new tags.
                    // If they are strictly equal Set-wise, maybe no change?
                    // Let's just set it.
                    currentTags = newTags;
                    changed = true;
                }

                if (changed) {
                    // Store original for revert
                    if (!originalData[product.id]) {
                        originalData[product.id] = { tags: (product.tags || []) };
                    } else {
                        originalData[product.id].tags = (product.tags || []);
                    }

                    // Merge with existing update for this product if it exists in 'updates'
                    const existingUpdateIdx = updates.findIndex(u => (u.id === product.id || u.ownerId === product.id));
                    if (existingUpdateIdx !== -1) {
                        updates[existingUpdateIdx].tags = currentTags;
                        // NO longer appending to logNew to keep columns separate
                        updates[existingUpdateIdx].tagsOriginal = (product.tags || []).join(", ");
                        updates[existingUpdateIdx].tagsUpdated = currentTags.join(", ");
                    } else {
                        updates.push({
                            id: product.id,
                            title: product.title,
                            tags: currentTags,
                            tagsOriginal: (product.tags || []).join(", "),
                            tagsUpdated: currentTags.join(", ")
                        });
                    }

                    // Add to preview for secondary tags
                    if (previewItems.length < 100 && fieldToEdit !== 'tags') {
                        // Use id for reliable deduplication, falling back to title match for variants if needed
                        const existingPreviewItems = previewItems.filter(item =>
                            item.id === product.id ||
                            item.title === product.title ||
                            item.title?.startsWith(product.title + " - ")
                        );

                        if (existingPreviewItems.length > 0) {
                            existingPreviewItems.forEach(item => {
                                item.tagsOriginal = (product.tags || []).join(", ");
                                item.tagsUpdated = currentTags.join(", ");
                                if (!item.image) item.image = product.featuredImage?.url;
                            });
                        } else {
                            if (previewItems.length < 100) {
                                previewItems.push({
                                    _v: 2,
                                    isProductUpdate: true,
                                    id: product.id,
                                    title: product.title,
                                    image: product.featuredImage?.url || null,
                                    tagsOriginal: (product.tags || []).join(", "),
                                    tagsUpdated: currentTags.join(", "),
                                    original_price: product.variants?.nodes?.[0]?.price || null,
                                    updated_price: product.variants?.nodes?.[0]?.price || null,
                                    original_compare: product.variants?.nodes?.[0]?.compareAtPrice || null,
                                    updated_compare: product.variants?.nodes?.[0]?.compareAtPrice || null,
                                    status: 'pending'
                                });
                            }
                        }
                    }
                }
            }

            // Variant-level fields
            const applyToVariants = config.applyToVariants || "all";
            const variantMatchLogic = config.variantMatchLogic || "all";
            const variantConditions = config.variantConditions || [];

            if (product.variants?.nodes) {
                for (const variant of product.variants.nodes) {
                    // Skip variant loop for product-level fields to avoid duplicate logging/processing
                    if (['status', 'tags', 'vendor', 'product_type'].includes(fieldToEdit)) {
                        continue;
                    }

                    // Check variant conditions
                    if (applyToVariants === 'conditions' && variantConditions.length > 0) {
                        const results = variantConditions.map((c: any) => {
                            if (!c.value && !['price', 'compare_at', 'inventory'].includes(c.property)) return true;

                            let targetValue = "";
                            if (c.property === "title") targetValue = variant.title;
                            if (c.property === "sku") targetValue = variant.sku || "";
                            if (c.property === "price") targetValue = variant.price;
                            if (c.property === "compare_at") targetValue = variant.compareAtPrice || "0";
                            if (c.property === "inventory") targetValue = variant.inventoryQuantity?.toString() || "0";

                            if (c.property === "option_name") {
                                return variant.selectedOptions.some((opt: any) => {
                                    const val = opt.name.toLowerCase();
                                    const search = c.value.toLowerCase();
                                    if (c.operator === "contains") return val?.includes(search);
                                    if (c.operator === "equals") return val === search;
                                    if (c.operator === "starts_with") return val.startsWith(search);
                                    if (c.operator === "ends_with") return val.endsWith(search);
                                    return false;
                                });
                            }
                            if (c.property === "option_value") {
                                return variant.selectedOptions.some((opt: any) => {
                                    const val = opt.value.toLowerCase();
                                    const search = c.value.toLowerCase();
                                    if (c.operator === "contains") return val?.includes(search);
                                    if (c.operator === "equals") return val === search;
                                    if (c.operator === "starts_with") return val.startsWith(search);
                                    if (c.operator === "ends_with") return val.endsWith(search);
                                    return false;
                                });
                            }

                            const searchVal = c.value.toLowerCase();
                            const targetValLower = targetValue.toLowerCase();

                            if (['price', 'compare_at', 'inventory'].includes(c.property)) {
                                const nTarget = parseFloat(targetValue) || 0;
                                const nSearch = parseFloat(c.value) || 0;
                                if (c.operator === "equals") return nTarget === nSearch;
                                if (c.operator === "greater_than") return nTarget > nSearch;
                                if (c.operator === "less_than") return nTarget < nSearch;
                                return false;
                            }

                            if (c.operator === "contains") return targetValLower?.includes(searchVal);
                            if (c.operator === "equals") return targetValLower === searchVal;
                            if (c.operator === "starts_with") return targetValLower.startsWith(searchVal);
                            if (c.operator === "ends_with") return targetValLower.endsWith(searchVal);

                            return false;
                        });

                        const matches = variantMatchLogic === 'any' ? results.some((r: boolean) => r === true) : results.every((r: boolean) => r === true);
                        if (!matches) continue;
                    }

                    let effectiveInventory = variant.inventoryQuantity || 0;
                    let targetLocationId = config.locationId;

                    const extractPlainId = (gid: any) => {
                        if (!gid || typeof gid !== 'string') return gid;
                        return gid.split('/').pop()?.split('?')[0];
                    };

                    if (fieldToEdit === 'inventory') {
                        const levels = variant.inventoryItem?.inventoryLevels?.edges || [];
                        const targetEdge = targetLocationId
                            ? levels.find((e: any) => extractPlainId(e.node?.location?.id) === extractPlainId(targetLocationId))
                            : (levels.length > 0 ? levels[0] : null);

                        if (targetEdge) {
                            const quantities = targetEdge.node?.quantities || [];
                            effectiveInventory = quantities.find((q: any) => q.name === "available")?.quantity ?? (quantities[0]?.quantity || 0);
                            targetLocationId = targetEdge.node?.location?.id;
                        } else {
                            if (fieldToEdit === 'inventory') {
                                console.log(`[Job ${job.jobId}] Variant ${variant.id} has no inventory level for location ${targetLocationId}. Available locations: ${levels.map((l: any) => l.node?.location?.id).join(', ')}`);
                            }
                            effectiveInventory = 0;
                        }
                    }

                    const originalPrice = parseFloat(variant.price) || 0;
                    const compareAtPrice = parseFloat(variant.compareAtPrice) || 0;
                    const cost = parseFloat(variant.inventoryItem?.unitCost?.amount) || 0;

                    originalData[variant.id] = {
                        productId: product.id,
                        price: variant.price,
                        compareAtPrice: variant.compareAtPrice,
                        inventoryQuantity: effectiveInventory,
                        locationId: targetLocationId,
                        inventoryItemId: variant.inventoryItem?.id,
                        cost: variant.inventoryItem?.unitCost?.amount,
                        weight: variant.inventoryItem?.measurement?.weight?.value,
                        weightUnit: variant.inventoryItem?.measurement?.weight?.unit,
                        requiresShipping: variant.inventoryItem?.requiresShipping,
                        taxable: variant.taxable
                    };

                    let update: any = {
                        id: variant.id,
                        productId: product.id,
                        title: product.title + (variant.title !== 'Default Title' ? ` - ${variant.title}` : ''),
                        logOriginal: originalPrice, // Fallback, updated below
                        logNew: 0
                    };
                    let originalVal: any = originalPrice;
                    let updatedVal: any = 0;
                    const numEditValue = parseFloat(editValue) || 0;

                    const ruleResult = applyRulesToVariant(
                        {
                            ...variant,
                            inventoryQuantity: effectiveInventory,
                            cost: variant.inventoryItem?.unitCost?.amount,
                            weight: variant.inventoryItem?.measurement?.weight?.value,
                            weightUnit: variant.inventoryItem?.measurement?.weight?.unit,
                            requiresShipping: variant.inventoryItem?.requiresShipping
                        },
                        config
                    );

                    if (config.applyToMarkets && ['price', 'compare_price'].includes(fieldToEdit) && Object.keys(marketPriceLists).length > 0) {
                        for (const [mHandle, mInfo] of Object.entries(marketPriceLists)) {
                            // Market price list update
                            updates.push({
                                priceListId: mInfo.priceListId,
                                variantId: variant.id,
                                marketHandle: mHandle,
                                price: fieldToEdit === 'price' ? ruleResult.updatedPrice : (fieldToEdit === 'compare_price' && config.priceOption === 'set' ? ruleResult.updatedPrice : variant.price),
                                compareAtPrice: fieldToEdit === 'price' ? ruleResult.updatedCompareAt : (fieldToEdit === 'compare_price' ? ruleResult.updatedValue : variant.compareAtPrice)
                            });
                        }
                    }

                    // Default to updating base price unless explicitly disabled when using markets
                    if (!config.applyToMarkets || config.applyToBasePrice !== false) {
                        if (fieldToEdit === 'price') {
                            update.price = ruleResult.updatedPrice;
                            if (ruleResult.updatedCompareAt !== undefined) {
                                update.compareAtPrice = ruleResult.updatedCompareAt;
                            }
                        } else if (fieldToEdit === 'compare_price') {
                            update.compareAtPrice = ruleResult.updatedValue;
                            if (config.priceOption === 'set') {
                                update.price = ruleResult.updatedPrice;
                            }
                        } else if (fieldToEdit === 'cost') {
                            update.inventoryItemId = variant.inventoryItem?.id;
                            update.unitCost = ruleResult.updatedValue;
                        } else if (fieldToEdit === 'inventory') {
                            update.inventoryItemId = variant.inventoryItem?.id;
                            update.quantity = ruleResult.updatedInventory;
                            update.locationId = targetLocationId;
                        }
                        else if (fieldToEdit === 'weight') {
                            const unitMap: any = { "kg": "KILOGRAMS", "g": "GRAMS", "lb": "POUNDS", "oz": "OUNCES", "KILOGRAMS": "KILOGRAMS", "GRAMS": "GRAMS", "POUNDS": "POUNDS", "OUNCES": "OUNCES" };
                            const targetUnit = unitMap[config.weightUnit] || unitMap[variant.inventoryItem?.measurement?.weight?.unit] || "KILOGRAMS";
                            update.inventoryItem = {
                                measurement: {
                                    weight: {
                                        value: ruleResult.updatedWeight,
                                        unit: targetUnit
                                    }
                                }
                            };
                        }
                    } // End of base price update block

                    // Handle requires_shipping and taxable OUTSIDE market conditional - these should always update
                    if (fieldToEdit === 'requires_shipping') {
                        update.inventoryItem = {
                            requiresShipping: editValue === 'true'
                        };
                        console.log(`[DEBUG] requires_shipping update for variant ${variant.id}:`, JSON.stringify(update));
                    } else if (fieldToEdit === 'taxable') {
                        update.taxable = editValue === 'true';
                        console.log(`[DEBUG] taxable update for variant ${variant.id}:`, JSON.stringify(update));
                    }

                    update.logOriginal = ruleResult.originalValue;
                    update.logNew = ruleResult.updatedValue;

                    // Always push requires_shipping, taxable, and INVENTORY updates, regardless of market settings
                    if (fieldToEdit === 'requires_shipping' || fieldToEdit === 'taxable' || fieldToEdit === 'inventory') {
                        if (Object.keys(update).length > 3) {
                            updates.push(update);
                            console.log(`[DEBUG] Pushed ${fieldToEdit} update to array. Total updates: ${updates.length}`);
                        }
                    } else if (Object.keys(update).length > 3 && (!config.applyToMarkets || config.applyToBasePrice !== false)) {
                        updates.push(update);
                    } else {
                        console.log(`[DEBUG] Skipped update for ${variant.id} (Field: ${fieldToEdit}). Keys: ${Object.keys(update).length}, ApplyMarkets: ${config.applyToMarkets}, ApplyBase: ${config.applyToBasePrice}`);
                    }

                    if (previewItems.length < 100) {
                        previewItems.push({
                            _v: 2,
                            title: update.title,
                            image: product.featuredImage?.url || null,
                            original: ruleResult.originalValue,
                            updated: ruleResult.updatedValue,
                            original_price: ruleResult.originalPrice,
                            updated_price: ruleResult.updatedPrice,
                            original_compare: ruleResult.originalCompareAt,
                            updated_compare: ruleResult.updatedCompareAt,
                            status: 'pending'
                        });
                    }
                } // End of variant loop
            } // End of if (product.variants?.nodes)
        } // End of products loop

        // --- MEMORY OPTIMIZATION: Nullify products array after calculations ---
        (products as any) = null;


        // Save Calculation Results
        await prisma.priceJob.update({
            where: { jobId: job.jobId },
            data: {
                originalData: originalData || {},
                previewJson: previewItems || [],
                totalProducts: updates.length + metafieldDeletions.length, // Include deletions in count
                status: "running" // Transition to running phase
            }
        });

        // Execute metafield deletions for clear_value (standard pagination path)
        if (metafieldDeletions.length > 0) {
            console.log(`[Job ${job.jobId}] Executing ${metafieldDeletions.length} metafield deletions (clear_value)...`);
            const BATCH_SIZE = 5; // Conservative batch size for metafield deletions
            for (let i = 0; i < metafieldDeletions.length; i += BATCH_SIZE) {
                const chunk = metafieldDeletions.slice(i, i + BATCH_SIZE);
                await Promise.all(chunk.map(async metafield => {
                    console.log(`[Job ${job.jobId}] Deleting metafield: ${metafield.namespace}.${metafield.key} from ${metafield.ownerId}`);
                    try {
                        const res = await shopifyAdmin.graphql(
                            `mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) { 
                                metafieldsDelete(metafields: $metafields) { 
                                    deletedMetafields { ownerId namespace key } 
                                    userErrors { field message } 
                                } 
                            }`,
                            { variables: { metafields: [metafield] } }
                        );
                        const json = await res.json() as any;
                        console.log(`[Job ${job.jobId}] Metafield delete response:`, JSON.stringify(json, null, 2));

                        if (json.data?.metafieldsDelete?.userErrors?.length > 0) {
                            console.error(`[Job ${job.jobId}] Metafield delete errors:`, json.data.metafieldsDelete.userErrors);
                        } else if (json.data?.metafieldsDelete?.deletedMetafields) {
                            console.log(`[Job ${job.jobId}] Successfully deleted metafield: ${metafield.namespace}.${metafield.key} from ${metafield.ownerId}`);
                        }
                    } catch (e) {
                        console.error(`[Job ${job.jobId}] Failed to delete metafield ${metafield.namespace}.${metafield.key}`, e);
                    }
                }));
            }
            console.log(`[Job ${job.jobId}] Completed ${metafieldDeletions.length} metafield deletions.`);
        }

        // Calculation complete. Starting updates for ${updates.length} items.


        // Phase 2: Execution
        let processedCount = 0;
        let lastUpdateTime = Date.now();

        // Split updates for optimization
        const inventoryUpdates = updates.filter((u: any) => u.inventoryItemId && fieldToEdit === 'inventory');
        const marketUpdates = updates.filter((u: any) => u.priceListId);
        const variantUpdates = updates.filter((u: any) => u.productId && ['price', 'compare_price', 'weight', 'requires_shipping', 'taxable'].includes(fieldToEdit));
        const otherUpdates = updates.filter((u: any) => !inventoryUpdates?.includes(u) && !variantUpdates?.includes(u) && !marketUpdates?.includes(u));

        let hasActiveBulkOp = false;
        let bulkProcessedType: 'variants' | 'markets' | 'inventory' | 'other' | null = null;

        // --- PHASE 3: Bulk Operations API Routing (Scalability Bypass) ---
        const totalUpdates = inventoryUpdates.length + variantUpdates.length + otherUpdates.length + marketUpdates.length;
        if (totalUpdates >= BULK_THRESHOLD) {
            console.log(`[Job ${job.job_id}] Threshold exceeded (${totalUpdates} >= ${BULK_THRESHOLD}). Routing to Shopify Bulk API...`);

            try {
                let mutation = "";
                let jsonlRows: any[] = [];

                // Priority: Base Variants > Markets > Inventory > Other
                if (variantUpdates.length > 0 && ['price', 'compare_price', 'weight', 'requires_shipping', 'taxable'].includes(fieldToEdit)) {
                    mutation = `mutation bulkUpdateJob($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                            product { id }
                            productVariants { id }
                            userErrors { field message }
                        }
                    }`;
                    jsonlRows = variantUpdates.map(u => {
                        const variantInput: any = { id: u.id };
                        if (u.price !== undefined) variantInput.price = u.price.toString();
                        if (u.compareAtPrice !== undefined) variantInput.compareAtPrice = u.compareAtPrice !== null ? u.compareAtPrice.toString() : null;

                        // Handle Weight
                        if (u.inventoryItem?.measurement?.weight?.value !== undefined) {
                            variantInput.inventoryItem = {
                                measurement: {
                                    weight: {
                                        unit: u.inventoryItem.measurement.weight.unit,
                                        value: Number(u.inventoryItem.measurement.weight.value)
                                    }
                                }
                            };
                        }

                        // Handle Taxable
                        if (u.taxable !== undefined) variantInput.taxable = u.taxable;

                        // Handle Requires Shipping
                        if (u.inventoryItem?.requiresShipping !== undefined) {
                            variantInput.inventoryItem = {
                                ...variantInput.inventoryItem,
                                requiresShipping: u.inventoryItem.requiresShipping
                            };
                        }

                        return {
                            productId: u.productId,
                            variants: [variantInput]
                        };
                    });
                    bulkProcessedType = 'variants';

                } else if (config.applyToMarkets && marketUpdates.length > 0) {
                    mutation = `mutation($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
                        priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
                            userErrors { field message }
                        }
                    }`;
                    jsonlRows = marketUpdates.map(u => ({
                        priceListId: u.priceListId,
                        prices: [{
                            variantId: u.variantId,
                            price: Number(u.price),
                            compareAtPrice: u.compareAtPrice !== null && u.compareAtPrice !== undefined ? Number(u.compareAtPrice) : null
                        }]
                    }));
                    bulkProcessedType = 'markets';

                } else if (fieldToEdit === 'status' || fieldToEdit === 'tags' || fieldToEdit === 'vendor' || fieldToEdit === 'product_type') {
                    mutation = `mutation($input: ProductInput!) {
                        productUpdate(input: $input) {
                            product { id }
                            userErrors { field message }
                        }
                    }`;
                    jsonlRows = otherUpdates.map(u => {
                        const input: any = { id: u.id };
                        if (u.tags) input.tags = u.tags;
                        if (u.status) input.status = u.status;
                        if (u.vendor !== undefined) input.vendor = u.vendor;
                        if (u.productType !== undefined) input.productType = u.productType;
                        return { input };
                    });
                    bulkProcessedType = 'other';
                } else if (fieldToEdit === 'inventory') {
                    mutation = `mutation($input: InventorySetQuantitiesInput!) {
                        inventorySetQuantities(input: $input) {
                            inventoryAdjustmentGroup { id }
                            userErrors { field message }
                        }
                    }`;
                    jsonlRows = inventoryUpdates.map(u => ({
                        input: {
                            name: "available",
                            reason: "correction",
                            quantities: [{
                                inventoryItemId: u.inventoryItemId,
                                locationId: primaryLocationId,
                                quantity: u.quantity
                            }]
                        }
                    }));
                    bulkProcessedType = 'inventory';
                } else if (fieldToEdit === 'metafield') {
                    mutation = `mutation($metafields: [MetafieldsSetInput!]!) {
                        metafieldsSet(metafields: $metafields) {
                            metafields { id }
                            userErrors { field message }
                        }
                    }`;
                    jsonlRows = otherUpdates.map(u => ({
                        metafields: u.metafields.map((m: any) => ({
                            ownerId: u.ownerId,
                            namespace: m.namespace,
                            key: m.key,
                            type: m.type,
                            value: m.value
                        }))
                    }));
                    bulkProcessedType = 'other';
                } else if (fieldToEdit === 'cost') {
                    mutation = `mutation($id: ID!, $input: InventoryItemInput!) {
                        inventoryItemUpdate(id: $id, input: $input) {
                            inventoryItem { id }
                            userErrors { field message }
                        }
                    }`;
                    jsonlRows = otherUpdates.map(u => ({
                        id: u.inventoryItemId,
                        input: { cost: u.unitCost }
                    }));
                    bulkProcessedType = 'other';
                }

                if (mutation && jsonlRows.length > 0) {
                    const target = await createStagedUpload(job.shopDomain, `bulk_job_${job.jobId}.jsonl`);
                    const jsonlContent = jsonlRows.map(r => JSON.stringify(r)).join("\n");
                    const resourceUrl = await uploadJsonl(target, jsonlContent);
                    const operation = await runBulkMutation(job.shopDomain, mutation, resourceUrl);

                    console.log(`[Job ${job.jobId}] Bulk Operation started: ${operation.id}`);

                    // Update job with status and operation ID
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: {
                            status: "processing",
                            note: `Shopify Bulk Operation ID: ${operation.id}`
                        }
                    });

                    hasActiveBulkOp = true;
                    // Do NOT return here. Continue to process other types manually.
                }
            } catch (bulkErr: any) {
                if (bulkErr.message?.includes("BULK_MUTATION_IN_PROGRESS") || bulkErr.message?.includes("already in progress")) {
                    console.log(`[Job ${job.jobId}] Bulk Mutation already in progress in Shopify. Rescheduling for later.`);
                    // We need to revert the status so it can be picked up again
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: {
                            status: "scheduled",
                            startTime: new Date(Date.now() + 60000) // Retry in 1 minute
                        }
                    });
                    return;
                }
                console.error(`[Job ${job.jobId}] Bulk API Failure, falling back to standard:`, bulkErr);
                // Fall through to manual processing if bulk fails
            }
        }

        // --- MEMORY OPTIMIZATION: Clear updates array once split ---
        (updates as any) = null;

        console.log(`[Job ${job.job_id}] Manual Processing: ${inventoryUpdates.length} inventory, ${variantUpdates.length} variant, ${otherUpdates.length} other updates.`);

        // 1. OPTIMIZED: Batch Inventory Updates (Up to 250 per call)
        // 1. OPTIMIZED: Batch Inventory Updates (Up to 250 per call)
        logDebug(`[Job ${job.jobId}] Ready to batch update inventory. Count: ${inventoryUpdates.length}, LocationID: ${primaryLocationId}, BulkProcessedType: ${bulkProcessedType}`);

        // Check if we have global location OR if individual updates have locations
        const hasAnyLocation = primaryLocationId || inventoryUpdates.some((u: any) => u.locationId);

        if (inventoryUpdates.length > 0 && hasAnyLocation) {
            const CHUNK_SIZE = 200; // Safe limit below 250
            for (let i = 0; i < inventoryUpdates.length; i += CHUNK_SIZE) {
                // Kill check
                const check = await prisma.priceJob.findUnique({ where: { jobId: job.jobId }, select: { status: true } });
                if (check?.status === 'cancelled') throw new Error("Job cancelled by administrator.");

                const chunk = inventoryUpdates.slice(i, i + CHUNK_SIZE);
                const quantities = chunk.map((u: any) => ({
                    inventoryItemId: u.inventoryItemId,
                    locationId: u.locationId || primaryLocationId,
                    quantity: u.quantity
                }));

                try {
                    logDebug(`[Job ${job.jobId}] Sending Inventory Payload: ${JSON.stringify(quantities)}`);
                    const res = await shopifyAdmin.graphql(
                        `mutation inventorySet($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { field message } } }`,
                        { variables: { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities } } }
                    );

                    // Basic error checking
                    const json = await res.json() as any;
                    logDebug(`[Job ${job.jobId}] Inventory Response: ${JSON.stringify(json)}`);
                    const errors = json.data?.inventorySetQuantities?.userErrors;

                    if (errors && errors.length > 0) {
                        logDebug(`[Job ${job.jobId}] Inventory batch errors: ${JSON.stringify(errors)}`);
                        console.error(`[Job ${job.jobId}] Inventory batch errors:`, JSON.stringify(errors));

                        // AUTO-FIX: Activate inventory at location if not stocked
                        const unstockedErrors = errors.filter((e: any) => e.message?.includes("not stocked"));
                        if (unstockedErrors.length > 0) {
                            logDebug(`[Job ${job.jobId}] Detected ${unstockedErrors.length} unstocked items. Attempting activation...`);

                            for (const err of unstockedErrors) {
                                // Parse index from field path: ["input", "quantities", "0", "locationId"]
                                const index = err.field?.[2] ? parseInt(err.field[2]) : -1;
                                if (index >= 0 && quantities[index]) {
                                    const item = quantities[index];
                                    try {
                                        await shopifyAdmin.graphql(
                                            `mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
                                                inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
                                                    inventoryLevel { id }
                                                    userErrors { field message }
                                                }
                                            }`,
                                            { variables: { inventoryItemId: item.inventoryItemId, locationId: item.locationId } }
                                        );
                                    } catch (actErr) {
                                        logDebug(`[Job ${job.jobId}] Activation failed for ${item.inventoryItemId}: ${actErr}`);
                                    }
                                }
                            }

                            // Retry the exact same batch after activation attempts
                            logDebug(`[Job ${job.jobId}] Retrying batch after activation...`);
                            const retryRes = await shopifyAdmin.graphql(
                                `mutation inventorySet($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { field message } } }`,
                                { variables: { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities } } }
                            );
                            const retryJson = await retryRes.json() as any;
                            logDebug(`[Job ${job.jobId}] Retry Response: ${JSON.stringify(retryJson)}`);
                        }
                    }

                    if (runId) {
                        await bulkLogRunItems(
                            runId,
                            job.shopDomain,
                            'inventory',
                            chunk,
                            errors?.length > 0 ? 'failed' : 'success',
                            errors?.map((e: any) => e.message).join(", ")
                        );
                    }

                    if (errors?.length > 0) {
                        console.error("Inventory Batch Error:", JSON.stringify(errors));
                    }
                } catch (err) {
                    console.error("Failed to execute inventory batch:", err);
                    if (runId) {
                        await bulkLogRunItems(runId, job.shopDomain, 'inventory', chunk, 'failed', String(err));
                    }
                }

                processedCount += chunk.length;

                const now = Date.now();
                if (now - lastUpdateTime > 1000) {
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: { processedProducts: processedCount }
                    });
                    lastUpdateTime = now;
                }
            }
        }

        // 2. OPTIMIZED: Group Variant Updates by Product (One call per product)
        if (variantUpdates.length > 0) {
            // Group by Product ID
            const byProduct: Record<string, { shopifyVariants: any[], logEntries: any[] }> = {};
            for (const u of variantUpdates) {
                if (!byProduct[u.productId]) byProduct[u.productId] = { shopifyVariants: [], logEntries: [] };

                const updateObject: any = { id: u.id };
                if (u.price !== undefined) updateObject.price = u.price.toString();
                if (u.compareAtPrice !== undefined) updateObject.compareAtPrice = u.compareAtPrice !== null ? u.compareAtPrice.toString() : null;

                if (u.inventoryItem?.measurement?.weight?.value !== undefined) {
                    updateObject.inventoryItem = {
                        measurement: {
                            weight: {
                                unit: u.inventoryItem.measurement.weight.unit,
                                value: Number(u.inventoryItem.measurement.weight.value)
                            }
                        }
                    };
                }

                if (u.inventoryItem?.requiresShipping !== undefined) {
                    updateObject.inventoryItem = {
                        ...updateObject.inventoryItem,
                        requiresShipping: u.inventoryItem.requiresShipping
                    };
                }
                if (u.taxable !== undefined) updateObject.taxable = u.taxable;

                if (fieldToEdit === 'requires_shipping' || fieldToEdit === 'taxable') {
                    console.log(`[DEBUG] Shopify mutation object for ${fieldToEdit}:`, JSON.stringify(updateObject));
                }

                byProduct[u.productId].shopifyVariants.push(updateObject);
                byProduct[u.productId].logEntries.push(u);
            }

            const productIds = Object.keys(byProduct);
            const CONCURRENCY = 20; // Parallel products being updated

            for (let i = 0; i < productIds.length; i += CONCURRENCY) {
                // Kill check
                const check = await prisma.priceJob.findUnique({ where: { jobId: job.jobId }, select: { status: true } });
                if (check?.status === 'cancelled') throw new Error("Job cancelled by administrator.");

                const batchProductIds = productIds.slice(i, i + CONCURRENCY);

                await Promise.all(batchProductIds.map(async (productId) => {
                    const { shopifyVariants, logEntries } = byProduct[productId];
                    try {
                        await shopifyAdmin.graphql(
                            `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                                productVariantsBulkUpdate(productId: $productId, variants: $variants) { 
                                    userErrors { field message }
                                }
                            }`,
                            { variables: { productId, variants: shopifyVariants } }
                        );
                        processedCount += shopifyVariants.length;

                        if (runId) {
                            await bulkLogRunItems(runId, job.shopDomain, fieldToEdit, logEntries, 'success');
                        }
                    } catch (err) {
                        console.error(`Failed variant update for product ${productId}:`, err);
                        if (runId) {
                            await bulkLogRunItems(runId, job.shopDomain, fieldToEdit, logEntries, 'failed', String(err));
                        }
                    }
                }));

                const now = Date.now();
                if (now - lastUpdateTime > 1000) {
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: { processedProducts: processedCount }
                    });
                    lastUpdateTime = now;
                }
            }
        }

        // 3. STANDARD: Process Remaining Updates (Tags, Cost, Status, Metafield)
        // Increased concurrency for speed
        if (otherUpdates.length > 0 && bulkProcessedType !== 'other') {
            const BATCH_SIZE = 50;

            for (let i = 0; i < otherUpdates.length; i += BATCH_SIZE) {
                // Kill check
                const check = await prisma.priceJob.findUnique({ where: { jobId: job.jobId }, select: { status: true } });
                if (check?.status === 'cancelled') throw new Error("Job cancelled by administrator.");

                const batch = otherUpdates.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (update: any) => {
                    let status = 'success';
                    let errorMessage = null;
                    try {
                        if (fieldToEdit === 'metafield') {
                            const metafieldInput = update.metafields.map((m: any) => ({
                                ownerId: update.ownerId,
                                namespace: m.namespace,
                                key: m.key,
                                type: m.type,
                                value: m.value
                            }));
                            console.log(`[Job ${job.jobId}] Metafield Update - ownerId: ${update.ownerId}, input:`, JSON.stringify(metafieldInput, null, 2));

                            const res = await shopifyAdmin.graphql(
                                `#graphql
                                mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                                    metafieldsSet(metafields: $metafields) {
                                        metafields { id namespace key value }
                                        userErrors { field message }
                                    }
                                }`,
                                {
                                    variables: {
                                        metafields: metafieldInput
                                    }
                                }
                            );
                            const json = await res.json() as any;
                            console.log(`[Job ${job.jobId}] Metafield Update Response:`, JSON.stringify(json, null, 2));

                            if (json.data?.metafieldsSet?.userErrors?.length > 0) {
                                status = 'failed';
                                errorMessage = json.data.metafieldsSet.userErrors.map((e: any) => e.message).join(", ");
                                console.error(`[Job ${job.jobId}] Metafield Update Errors:`, errorMessage);
                            } else if (json.data?.metafieldsSet?.metafields) {
                                console.log(`[Job ${job.jobId}] Metafield Updated Successfully:`, json.data.metafieldsSet.metafields);
                            }
                        } else if (update.tags || update.status || update.vendor || update.productType || fieldToEdit === 'status' || fieldToEdit === 'vendor' || fieldToEdit === 'product_type') {
                            const input: any = { id: update.id };
                            if (update.tags) input.tags = update.tags;
                            if (update.status) input.status = update.status;
                            if (update.vendor !== undefined) input.vendor = update.vendor;
                            if (update.productType !== undefined) input.productType = update.productType;

                            const res = await shopifyAdmin.graphql(
                                `#graphql
                                mutation productUpdate($input: ProductInput!) {
                                    productUpdate(input: $input) {
                                        userErrors { field message }
                                    }
                                }`,
                                { variables: { input } }
                            );
                            const json = await res.json() as any;
                            if (json.data?.productUpdate?.userErrors?.length > 0) {
                                status = 'failed';
                                errorMessage = json.data.productUpdate.userErrors.map((e: any) => e.message).join(", ");
                            }
                        } else if (fieldToEdit === 'cost') {
                            const res = await shopifyAdmin.graphql(
                                `#graphql
                                mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
                                    inventoryItemUpdate(id: $id, input: $input) {
                                        userErrors { field message }
                                    }
                                }`,
                                { variables: { id: update.inventoryItemId, input: { cost: update.unitCost } } }
                            );
                            const json = await res.json() as any;
                            if (json.data?.inventoryItemUpdate?.userErrors?.length > 0) {
                                status = 'failed';
                                errorMessage = json.data.inventoryItemUpdate.userErrors.map((e: any) => e.message).join(", ");
                            }
                        }
                    } catch (err) {
                        status = 'failed';
                        errorMessage = err instanceof Error ? err.message : String(err);
                    }

                    if (status === 'success') updatedCount++;
                    else failedCount++;

                    // Log Item
                    if (runId) {
                        await bulkLogRunItems(runId, job.shopDomain, fieldToEdit, [update], status as any, errorMessage);
                    }
                }));

                processedCount += batch.length;
                const now = Date.now();
                if (now - lastUpdateTime > 1000) {
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: { processedProducts: processedCount }
                    });
                    if (runId) {
                        await prisma.taskRun.update({
                            where: { id: runId },
                            data: {
                                successItems: updatedCount,
                                failedItems: failedCount
                            }
                        });
                    }
                    lastUpdateTime = now;
                }

                // --- SCALABILITY: Yield to event loop to prevent thread blocking ---
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // 4. Market Price List Updates (Manual fallback)
        if (marketUpdates.length > 0 && bulkProcessedType !== 'markets') {
            // Group by Price List ID
            const byPriceList: Record<string, { prices: any[], logEntries: any[] }> = {};
            for (const u of marketUpdates) {
                if (!byPriceList[u.priceListId]) byPriceList[u.priceListId] = { prices: [], logEntries: [] };

                byPriceList[u.priceListId].prices.push({
                    variantId: u.variantId,
                    price: Number(u.price),
                    compareAtPrice: u.compareAtPrice !== null && u.compareAtPrice !== undefined ? Number(u.compareAtPrice) : null
                });
                byPriceList[u.priceListId].logEntries.push(u);
            }

            for (const [priceListId, data] of Object.entries(byPriceList)) {
                const BATCH_SIZE = 200;
                for (let i = 0; i < data.prices.length; i += BATCH_SIZE) {
                    const chunk = data.prices.slice(i, i + BATCH_SIZE);
                    const logChunk = data.logEntries.slice(i, i + BATCH_SIZE);

                    try {
                        const res = await shopifyAdmin.graphql(
                            `mutation priceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
                                priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
                                    userErrors { field message }
                                }
                            }`,
                            { variables: { priceListId, prices: chunk } }
                        );

                        const resJson = await res.json() as any;
                        const errors = resJson.data?.priceListFixedPricesAdd?.userErrors;

                        processedCount += chunk.length;
                        if (!errors || errors.length === 0) {
                            updatedCount += chunk.length;
                        } else {
                            failedCount += chunk.length;
                        }


                        if (runId) {
                            await bulkLogRunItems(
                                runId,
                                job.shopDomain,
                                'market_price',
                                logChunk,
                                errors?.length > 0 ? 'failed' : 'success',
                                errors?.map((e: any) => e.message).join(", ")
                            );
                        }
                    } catch (err) {
                        console.error(`Failed market update for price list ${priceListId}:`, err);
                        failedCount += chunk.length;
                        if (runId) {
                            await bulkLogRunItems(
                                runId,
                                job.shopDomain,
                                'market_price',
                                logChunk,
                                'failed',
                                String(err)
                            );
                        }
                    }

                    const now = Date.now();
                    if (now - lastUpdateTime > 1000) {
                        await prisma.priceJob.update({
                            where: { jobId: job.jobId },
                            data: { processedProducts: processedCount }
                        });
                        lastUpdateTime = now;
                    }
                }
            }
        }

        // Attempt to update status and completed_at
        try {
            if (!hasActiveBulkOp) {
                // Only mark as completed if it hasn't been reverted/reverting in the meantime
                await prisma.priceJob.update({
                    where: {
                        jobId: job.jobId,
                        OR: [
                            { revertStatus: { equals: null } },
                            { revertStatus: 'none' }
                        ]
                    },
                    data: {
                        status: "completed",
                        completedAt: new Date()
                    }
                });
            }

            // Track Funnel Event: task_completed
            await trackEvent(job.shopDomain, 'task_completed');

            if (runId) {
                await prisma.taskRun.update({
                    where: { id: runId },
                    data: {
                        status: 'completed',
                        completedAt: new Date(),
                        updatedProducts: updatedCount,
                        failedProducts: failedCount,
                        totalItems: updatedCount + failedCount,
                        successItems: updatedCount,
                        failedItems: failedCount
                    }
                });
            }
        } catch (completeError) {
            console.error(`Failed to set job ${job.jobId} to completed: `, completeError);
            throw new Error(`Database error on completion: ${completeError instanceof Error ? completeError.message : String(completeError)} `);
        }

        console.log(`Job ${job.jobId} completed.`);

        // --- EMAIL NOTIFICATION ---
        await sendJobCompletionEmail(job, "completed");

    } catch (error) {
        console.error(`Job ${job.jobId} failed: `, error);
        if (runId) {
            await prisma.taskRun.update({
                where: { id: runId },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    errorMessage: error instanceof Error ? error.message : String(error)
                }
            });
        }

        // --- FIX: Ensure the PriceJob status is updated to failed to prevent hangs ---
        await prisma.priceJob.update({
            where: { jobId: job.jobId },
            data: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error)
            }
        });

        // --- EMAIL NOTIFICATION (Failure) ---
        await sendJobCompletionEmail({ ...job, error: error instanceof Error ? error.message : String(error) }, "failed");
    }
}

export async function revertJob(job: any) {
    try {
        // Attempt to claim the revert job and transition to reverting phase
        const claim = await prisma.priceJob.updateMany({
            where: {
                jobId: job.jobId,
                revertStatus: { in: ["scheduled", "revert_pending"] }
            },
            data: {
                status: "running",
                revertStatus: "reverting",
                note: null // Clear old notes (like BULK_MUTATION_ID) so they don't confuse polling
            }
        });

        if (claim.count === 0) {
            console.log(`[Job ${job.jobId}] Revert already claimed or status changed. Skipping revertJob execution.`);
            return;
        }

        console.log(`Starting revert for job ${job.jobId}: Execution phase`);

        // Get Shopify Session
        const shopifyAdmin = await getAuthenticatedAdmin(job.shopDomain);

        const originalData = job.originalData;
        if (!originalData) {
            throw new Error("No original data to revert.");
        }

        // Pre-fetch Location ID for inventory reverts
        let locRes;
        try {
            locRes = await shopifyAdmin.graphql(`{ locations(first: 1) { nodes { id } } } `);
        } catch (e) {
            console.error("LOC_ERR", e);
            locRes = { json: async () => ({ data: { locations: { nodes: [] } } }) };
        }
        const locJson = await (locRes as any).json() as any;
        const defaultLocationId = job.configuration?.locationId || locJson.data?.locations?.nodes?.[0]?.id;

        // Initialize collections for batching
        let entries = Object.entries(originalData as Record<string, any>);
        const totalToRevert = entries.length;
        let productUpdates: any[] = [];
        let variantUpdatesByProduct: Record<string, any[]> = {};
        let inventoryUpdates: any[] = [];
        let costUpdates: any[] = [];
        let metafieldUpdates: any[] = [];
        let variantFlatUpdates: any[] = []; // For bulk variant mutation

        // 1. Sort ALL entries into logical batches ONCE (NO internal fetches)
        for (const [id, data] of entries) {
            if (data.metafield !== undefined) {
                metafieldUpdates.push({ id, data: data.metafield });
            }
            if (data.status || data.tags || data.vendor || data.productType) {
                productUpdates.push({ id, data });
            }
            if (data.inventoryQuantity !== undefined && data.inventoryItemId) {
                const targetLocId = data.locationId || defaultLocationId;
                if (targetLocId) {
                    inventoryUpdates.push({
                        inventoryItemId: data.inventoryItemId,
                        locationId: targetLocId,
                        quantity: data.inventoryQuantity
                    });
                } else {
                    console.warn(`[Job ${job.jobId}] Variant ${id} has inventory to revert but no location ID found.`);
                }
            }
            if (data.cost !== undefined && data.inventoryItemId) {
                costUpdates.push({ id: data.inventoryItemId, cost: data.cost });
            }
            if (data.price !== undefined || data.weight !== undefined || data.requiresShipping !== undefined || data.taxable !== undefined) {
                const productId = data.productId; // Use pre-cached productId

                const vInput: any = { id };
                if (data.price !== undefined) vInput.price = data.price.toString();
                if (data.compareAtPrice !== undefined) vInput.compareAtPrice = data.compareAtPrice !== null ? data.compareAtPrice.toString() : null;

                if (data.weight !== undefined) {
                    const unitMap: any = { "kg": "KILOGRAMS", "g": "GRAMS", "lb": "POUNDS", "oz": "OUNCES" };
                    vInput.inventoryItem = { measurement: { weight: { unit: unitMap[data.weightUnit || "kg"] || "KILOGRAMS", value: Number(data.weight) } } };
                }
                if (data.requiresShipping !== undefined) {
                    if (!vInput.inventoryItem) vInput.inventoryItem = {};
                    vInput.inventoryItem.requiresShipping = data.requiresShipping;
                }
                if (data.taxable !== undefined) vInput.taxable = data.taxable;

                if (productId) {
                    if (!variantUpdatesByProduct[productId]) variantUpdatesByProduct[productId] = [];
                    variantUpdatesByProduct[productId].push(vInput);
                }
                variantFlatUpdates.push(vInput);
            }
        }

        // 2. Decide: Bulk Mutation vs Manual Parallelism
        // We use Bulk if the largest batch is > 100
        const batches = [
            { type: 'variant', size: variantFlatUpdates.length },
            { type: 'product', size: productUpdates.length },
            { type: 'inventory', size: inventoryUpdates.length },
            { type: 'cost', size: costUpdates.length },
            { type: 'metafield', size: metafieldUpdates.length }
        ];
        const biggestBatch = batches.reduce((prev, current) => (prev.size > current.size) ? prev : current);
        const biggestBatchSize = biggestBatch.size;

        let bulkTriggered = false;
        if (biggestBatchSize > 100) {
            console.log(`[Job ${job.jobId}] Revert scale large (${biggestBatchSize}). Triggering Bulk Revert for ${biggestBatch.type}...`);
            let mutation = "";
            let jsonlRows: any[] = [];
            try {

                if (biggestBatch.type === 'variant') {
                    mutation = `mutation bulkUpdateRevert($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                        product { id }
                        productVariants { id }
                        userErrors { field message }
                    }
                }`;
                    jsonlRows = Object.entries(variantUpdatesByProduct).map(([productId, variants]) => ({
                        productId,
                        variants
                    }));
                    variantFlatUpdates = []; // Handled by bulk
                    variantUpdatesByProduct = {};
                } else if (biggestBatch.type === 'product') {
                    mutation = `mutation($input: ProductInput!) {
                    productUpdate(input: $input) {
                        product { id }
                        userErrors { field message }
                    }
                }`;
                    jsonlRows = productUpdates.map(p => {
                        const input: any = { id: p.id };
                        if (p.data.status) input.status = p.data.status.toUpperCase();
                        if (p.data.tags) input.tags = p.data.tags;
                        if (p.data.vendor) input.vendor = p.data.vendor;
                        if (p.data.productType) input.productType = p.data.productType;
                        return { input };
                    });
                    productUpdates = []; // Handled by bulk
                } else if (biggestBatch.type === 'inventory') {
                    mutation = `mutation($input: InventorySetQuantitiesInput!) {
                    inventorySetQuantities(input: $input) {
                        inventoryAdjustmentGroup { id }
                        userErrors { field message }
                    }
                }`;
                    jsonlRows = inventoryUpdates.map(u => ({
                        input: {
                            name: "available",
                            reason: "correction",
                            ignoreCompareQuantity: true,
                            quantities: [u]
                        }
                    }));
                    inventoryUpdates = []; // Handled by bulk
                } else if (biggestBatch.type === 'cost') {
                    mutation = `mutation($id: ID!, $input: InventoryItemInput!) {
                    inventoryItemUpdate(id: $id, input: $input) {
                        inventoryItem { id }
                        userErrors { field message }
                    }
                }`;
                    jsonlRows = costUpdates.map(u => ({ id: u.id, input: { cost: u.cost } }));
                    costUpdates = []; // Handled by bulk
                } else if (biggestBatch.type === 'metafield') {
                    mutation = `mutation($metafields: [MetafieldsSetInput!]!) {
                    metafieldsSet(metafields: $metafields) {
                        metafields { id }
                        userErrors { field message }
                    }
                }`;
                    // Remove 'id' field from metafield data as it's not part of MetafieldsSetInput
                    jsonlRows = metafieldUpdates.map(m => {
                        const { id, ...metafieldData } = m.data;
                        return { metafields: [{ ownerId: m.id, ...metafieldData }] };
                    });
                    metafieldUpdates = []; // Handled by bulk
                }

                if (mutation && jsonlRows.length > 0) {
                    const target = await createStagedUpload(job.shopDomain, `bulk_revert_${job.jobId}.jsonl`);
                    const jsonlContent = jsonlRows.map(r => JSON.stringify(r)).join("\n");
                    const resourceUrl = await uploadJsonl(target, jsonlContent);
                    const operation = await runBulkMutation(job.shopDomain, mutation, resourceUrl);

                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: {
                            revertStatus: "reverting",
                            note: `BULK_REVERT_ID:${operation.id}`
                        }
                    });
                    console.log(`[Job ${job.jobId}] Bulk Revert Operation started: ${operation.id}`);
                    bulkTriggered = true;
                    // We DON'T return here anymore, we proceed to handle other batches manually
                }
            } catch (bulkErr: any) {
                if (bulkErr.message?.includes("BULK_MUTATION_IN_PROGRESS") || bulkErr.message?.includes("already in progress")) {
                    console.log(`[Job ${job.jobId}] Bulk Mutation already in progress in Shopify for revert. Rescheduling for later.`);
                    await prisma.priceJob.update({
                        where: { jobId: job.jobId },
                        data: {
                            revertStatus: "scheduled",
                            scheduledRevertAt: new Date(Date.now() + 60000) // Retry in 1 minute
                        }
                    });
                    return;
                }
                console.error(`[Job ${job.jobId}] Bulk Revert API Failure, falling back to standard:`, bulkErr);
            }
        }


        // 3. Manual Fallback (Standard Batched Execution)
        let processedCount = 0;
        let lastUpdateTime = Date.now();
        const updateDBProgress = async (count: number) => {
            const now = Date.now();
            if (now - lastUpdateTime > 1000 || count >= totalToRevert) {
                await prisma.priceJob.update({
                    where: { jobId: job.jobId },
                    data: { processedProducts: count }
                });
                lastUpdateTime = now;
            }
        };

        // StandardBatched execution logic follows (Inventory, Variants, etc.)
        // A. Inventory Batch
        if (inventoryUpdates.length > 0) {
            console.log(`[Job ${job.jobId}] Reverting ${inventoryUpdates.length} inventory items...`);
            console.log(`[Job ${job.jobId}] Sample inventory update:`, JSON.stringify(inventoryUpdates[0], null, 2));

            const CHUNK = 200;
            for (let i = 0; i < inventoryUpdates.length; i += CHUNK) {
                const check = await prisma.priceJob.findUnique({ where: { jobId: job.jobId }, select: { status: true } });
                if (check?.status === 'cancelled') throw new Error("Job cancelled by administrator.");

                const chunk = inventoryUpdates.slice(i, i + CHUNK);
                console.log(`[Job ${job.jobId}] Processing inventory chunk ${i / CHUNK + 1}, size: ${chunk.length}`);

                const response = await shopifyAdmin.graphql(
                    `mutation inventorySet($input: InventorySetQuantitiesInput!) { 
                        inventorySetQuantities(input: $input) { 
                            inventoryAdjustmentGroup { id }
                            userErrors { field message } 
                        } 
                    }`,
                    {
                        variables: {
                            input: {
                                name: "available",
                                reason: "correction",
                                ignoreCompareQuantity: true,
                                quantities: chunk.map(u => ({
                                    inventoryItemId: u.inventoryItemId,
                                    locationId: u.locationId,
                                    quantity: u.quantity
                                }))
                            }
                        }
                    }
                );

                const responseJson = await response.json() as any;
                console.log(`[Job ${job.jobId}] Inventory mutation response:`, JSON.stringify(responseJson, null, 2));

                if (responseJson.data?.inventorySetQuantities?.userErrors?.length > 0) {
                    console.error(`[Job ${job.jobId}] Inventory revert errors:`, responseJson.data.inventorySetQuantities.userErrors);
                }

                processedCount += chunk.length;
                await updateDBProgress(processedCount);
            }
            console.log(`[Job ${job.jobId}] Inventory revert completed successfully`);
        }

        // B. Variant Bulk Updates
        const pIdsForManual = Object.keys(variantUpdatesByProduct);
        for (const pId of pIdsForManual) {
            const check = await prisma.priceJob.findUnique({ where: { jobId: job.jobId }, select: { status: true } });
            if (check?.status === 'cancelled') throw new Error("Job cancelled by administrator.");

            const variants = variantUpdatesByProduct[pId];
            await shopifyAdmin.graphql(
                `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                    productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
                }`,
                { variables: { productId: pId, variants } }
            );
            processedCount += variants.length;
            await updateDBProgress(processedCount);
        }

        // C. Individual Product/Metafield/Cost Updates
        const remainingBatch = [...productUpdates, ...metafieldUpdates, ...costUpdates];
        const CONCURRENCY = 40; // Increased for performance, but we add a small delay
        for (let i = 0; i < remainingBatch.length; i += CONCURRENCY) {
            const check = await prisma.priceJob.findUnique({ where: { jobId: job.jobId }, select: { status: true } });
            if (check?.status === 'cancelled') throw new Error("Job cancelled by administrator.");

            const chunk = remainingBatch.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(async (item: any) => {
                try {
                    if (item.data?.status || item.data?.tags || item.data?.vendor || item.data?.productType) {
                        const input: any = { id: item.id };
                        if (item.data.status) input.status = item.data.status.toUpperCase();
                        if (item.data.tags) {
                            // Ensure tags are an array (could be a string from older tasks)
                            input.tags = Array.isArray(item.data.tags) ? item.data.tags :
                                (typeof item.data.tags === 'string' ? item.data.tags.split(",").map((t: any) => t.trim()).filter(Boolean) : []);
                        }
                        if (item.data.vendor !== undefined) input.vendor = item.data.vendor;
                        if (item.data.productType !== undefined) input.productType = item.data.productType;
                        await shopifyAdmin.graphql(
                            `mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }`,
                            { variables: { input } }
                        );
                    } else if (item.data?.namespace) {
                        // Remove 'id' field as it's not part of MetafieldsSetInput
                        const { id, ...metafieldData } = item.data;
                        const metafieldInput = { ownerId: item.id, ...metafieldData };
                        console.log(`[Job ${job.jobId}] Reverting metafield for ${item.id}:`, JSON.stringify(metafieldInput, null, 2));
                        const response = await shopifyAdmin.graphql(
                            `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                                metafieldsSet(metafields: $metafields) { 
                                    metafields { id namespace key value }
                                    userErrors { field message } 
                                }
                            }`,
                            { variables: { metafields: [metafieldInput] } }
                        );
                        const responseJson = await response.json() as any;
                        console.log(`[Job ${job.jobId}] Metafield revert response:`, JSON.stringify(responseJson, null, 2));
                        if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
                            console.error(`[Job ${job.jobId}] Metafield revert errors:`, responseJson.data.metafieldsSet.userErrors);
                        }
                    } else if (item.cost !== undefined) {
                        await shopifyAdmin.graphql(
                            `mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
                                inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } }
                            }`,
                            { variables: { id: item.id, input: { cost: item.cost } } }
                        );
                    }
                } catch (e) {
                    console.error(`Revert error for item ${item.id}:`, e);
                }
            }));
            processedCount += chunk.length;
            await updateDBProgress(processedCount);
            // Small sleep to respect Shopify's leaky bucket
            if (remainingBatch.length > CONCURRENCY) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }

        if (bulkTriggered) {
            console.log(`[Job ${job.jobId}] Manual components of revert completed. Bulk operation still running.`);
            return;
        }

        // Mark as finished if manual path succeeded
        await prisma.priceJob.update({
            where: { jobId: job.jobId },
            data: {
                status: "reverted",
                revertStatus: "reverted",
                revertedAt: new Date(),
                processedProducts: totalToRevert
            }
        });

        console.log(`Manual Revert completed for job ${job.jobId}`);

        // --- EMAIL NOTIFICATION (Revert Completed) ---
        try {
            const settings = await prisma.shopSettings.findUnique({ where: { shopDomain: job.shopDomain } });
            if (settings?.contactEmail) {
                await sendRevertCompletedEmail({
                    taskName: (job.configuration as any)?.taskName || `Task #${job.jobId.substring(0, 8)}`,
                    taskId: job.jobId,
                    productsCount: job.totalProducts || 0,
                    completedAt: new Date().toLocaleString(),
                    shopName: settings.shopName || job.shopDomain,
                    shopDomain: job.shopDomain,
                    toEmail: settings.contactEmail,
                    editingRules: getTaskDescriptionList(job.configuration || {}).join(" • "),
                    appliesTo: getAppliesToText(job.configuration || {})
                });
            }
        } catch (e) {
            console.error("Failed to send revert email:", e);
        }

        // --- Memory Cleanup ---
        (entries as any) = null;
        (productUpdates as any) = null;
        (variantUpdatesByProduct as any) = null;
        (inventoryUpdates as any) = null;
        (costUpdates as any) = null;
        (metafieldUpdates as any) = null;

        // Already marked as reverted above
        console.log(`Job ${job.jobId} reverted successfully.`);

        // --- EMAIL NOTIFICATION (Revert Success) ---
        try {
            const settings = await prisma.shopSettings.findUnique({
                where: { shopDomain: job.shopDomain }
            });

            if (settings?.contactEmail) {
                await sendRevertCompletedEmail({
                    taskName: job.name,
                    taskId: job.jobId,
                    productsCount: job.totalProducts || 0,
                    completedAt: new Date().toLocaleString(),
                    shopName: settings.shopName || job.shopDomain,
                    shopDomain: job.shopDomain,
                    toEmail: settings.contactEmail,
                    editingRules: getTaskDescriptionList(job.configuration || {}).join(" • "),
                    appliesTo: getAppliesToText(job.configuration || {})
                });
            }
        } catch (emailErr) {
            console.error("Failed to send revert success notification:", emailErr);
        }

    } catch (error) {
        console.error(`Revert for job ${job.jobId} failed: `, error);
        await prisma.priceJob.update({
            where: { jobId: job.jobId },
            data: {
                status: "failed",
                revertStatus: "failed",
                error: error instanceof Error ? error.message : String(error)
            }
        });

        // --- EMAIL NOTIFICATION (Revert Failure) ---
        try {
            const settings = await prisma.shopSettings.findUnique({
                where: { shopDomain: job.shopDomain }
            });

            if (settings?.contactEmail) {
                await sendRevertFailedEmail({
                    taskName: job.name,
                    taskId: job.jobId,
                    error: error instanceof Error ? error.message : String(error),
                    shopName: settings.shopName || job.shopDomain,
                    shopDomain: job.shopDomain,
                    toEmail: settings.contactEmail,
                    completedAt: new Date().toLocaleString()
                });
            }
        } catch (emailErr) {
            console.error("Failed to send revert failure notification:", emailErr);
        }
    }
}

// Check for and execute scheduled reverts
export async function checkScheduledReverts() {
    try {
        // Find jobs that are scheduled to revert
        const jobs = await prisma.priceJob.findMany({
            where: {
                revertStatus: "scheduled",
                scheduledRevertAt: { lte: new Date() },
                status: "completed"
            }
        });

        if (jobs.length === 0) {
            console.log("No scheduled reverts to process");
            return;
        }

        console.log(`Found ${jobs.length} scheduled reverts to process`);

        // Process each scheduled revert
        for (const job of jobs) {
            console.log(`Processing scheduled revert for job ${job.jobId}`);
            await revertJob(job);
        }
    } catch (error) {
        console.error("Error fetching scheduled reverts:", error);
    }
}
