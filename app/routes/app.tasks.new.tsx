
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useSearchParams, useNavigate, useLoaderData, useFetcher, useSubmit, useNavigation, redirect, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import "../styles/tasks.css";
declare global {
    interface Window {
        shopify: any;
    }
}
import {
    Page,
    Layout,
    Card,
    TextField,
    Select,
    RadioButton,
    Checkbox,
    BlockStack,
    Box,
    Text,
    IndexTable,
    Banner,
    Button,
    InlineStack,
    Divider,
    ChoiceList,
    Bleed,
    Thumbnail,
    Pagination,
    Modal,
    DatePicker,
    Popover,
    Icon,
    InlineGrid,
    Autocomplete,
    Tag,
    Tabs,
    Badge,
    ActionList,
    ButtonGroup,
    Listbox,
    Combobox,
    Spinner,
} from "@shopify/polaris";
import { CalendarIcon, ClockIcon, AlertCircleIcon, SearchIcon, StarFilledIcon, StarIcon, StoreIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@shopify/polaris-icons";
import { ChevronUpIcon, LockIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { trackEvent } from "../services/analytics.server";
import { sendTaskScheduledEmail, sendRevertScheduledEmail } from "../services/email.server";
import { getTaskDescriptionList, getAppliesToText } from "../utils/task-descriptions";
import { processPendingJobs } from "../services/bulk-update.server";
import prisma from "../db.server";

import { getShopPlan } from "../services/billing.server";

/**
 * Prevents the page loader from re-running when we are just fetching preview data.
 * This breaks the infinite loop where fetching preview data triggers a loader re-run,
 * which creates new array references, which triggers another preview refresh.
 */
export function shouldRevalidate({
    actionResult,
    defaultShouldRevalidate,
    formData,
    nextUrl
}: {
    actionResult: any;
    defaultShouldRevalidate: boolean;
    formData: FormData | undefined;
    nextUrl: URL;
}) {
    // If we are just fetching preview data from any route, don't revalidate this page's loader
    if (formData?.get("intent") === "refresh-preview" || formData?.get("fieldToEdit")) {
        return false;
    }

    // If the navigation is stay on this page after a preview fetch, don't revalidate
    if (nextUrl.pathname.includes("/app/preview-data")) {
        return false;
    }

    return defaultShouldRevalidate;
}

/**
 * Syncs the task configuration to specialized tables for easier querying and analytics.
 */
async function syncSpecializedConfig(prisma: any, jobId: string, config: any, isUpdate: boolean = false) {
    const field = config.fieldToEdit;

    let modelName: "jobConfigPrice" | "jobConfigInventory" | "jobConfigCost" | "jobConfigTags" | "jobConfigStatus" | "jobConfigMetafield" | "jobConfigWeight" | "jobConfigVendor" | "jobConfigProductType" | "jobConfigShipping" | "jobConfigTaxable" | null = null;
    let payload: any = { jobId };

    switch (field) {
        case 'price':
        case 'compare_price':
            modelName = "jobConfigPrice";
            payload = {
                ...payload,
                editMethod: config.editMethod,
                editValue: parseFloat(config.editValue) || 0,
                roundingMethod: config.rounding || 'none',
                roundingValue: config.roundingValue,
                compareAtOption: config.compareAtPriceOption || 'none',
                compareAtMethod: config.compareAtEditMethod,
                compareAtValue: parseFloat(config.compareAtEditValue) || 0
            };
            break;
        case 'inventory':
            modelName = "jobConfigInventory";
            payload = {
                ...payload,
                method: config.editMethod,
                quantity: parseInt(config.editValue) || 0
            };
            break;
        case 'cost':
            modelName = "jobConfigCost";
            payload = {
                ...payload,
                method: config.editMethod,
                value: parseFloat(config.editValue) || 0,
                roundingMethod: config.rounding || 'none'
            };
            break;
        case 'tags':
            modelName = "jobConfigTags";
            payload = {
                ...payload,
                method: config.editMethod === 'add_tags' ? 'append' : (config.editMethod === 'remove_tags' ? 'remove' : 'replace'),
                tagsToAdd: config.editMethod === 'add_tags' ? (config.editValue || "").split(",").map((s: string) => s.trim()) : [],
                tagsToRemove: config.editMethod === 'remove_tags' ? (config.editValue || "").split(",").map((s: string) => s.trim()) : []
            };
            break;
        case 'status':
            modelName = "jobConfigStatus";
            payload = { ...payload, targetStatus: (config.editValue || 'ACTIVE').toUpperCase() };
            break;
        case 'metafield':
            modelName = "jobConfigMetafield";
            payload = {
                ...payload,
                namespace: config.metafieldNamespace,
                key: config.metafieldKey,
                value: config.editValue,
                valueType: config.metafieldType
            };
            break;
        case 'weight':
            modelName = "jobConfigWeight";
            payload = {
                ...payload,
                method: config.editMethod,
                value: parseFloat(config.editValue) || 0,
                unit: config.weightUnit || 'kg'
            };
            break;
        case 'vendor':
            modelName = "jobConfigVendor";
            payload = {
                ...payload,
                method: config.editMethod,
                value: config.editValue || "",
                findText: config.findText,
                replaceText: config.replaceText,
                prefixValue: config.editValue,
                suffixValue: config.editValue
            };
            break;
        case 'product_type':
            modelName = "jobConfigProductType";
            payload = {
                ...payload,
                method: config.editMethod,
                value: config.editValue || "",
                findText: config.findText,
                replaceText: config.replaceText,
                prefixValue: config.editValue,
                suffixValue: config.editValue
            };
            break;
        case 'requires_shipping':
            modelName = "jobConfigShipping";
            payload = { ...payload, value: String(config.editValue).toLowerCase() === 'true' };
            break;
        case 'taxable':
            modelName = "jobConfigTaxable";
            payload = { ...payload, value: String(config.editValue).toLowerCase() === 'true' };
            break;
    }

    if (modelName) {
        if (isUpdate) {
            // Prisma doesn't have a simple upsert for non-unique combinations without a helper
            // but we can delete and insert since job_id is one-to-one for these config tables in this context
            await (prisma[modelName] as any).deleteMany({ where: { jobId } });
            await (prisma[modelName] as any).create({ data: payload });
        } else {
            await (prisma[modelName] as any).create({ data: payload });
        }
    }
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "create-demo-product") {
        try {
            // 1. Fetch Location for inventory
            const locationResponse = await admin.graphql(
                `#graphql
                query getLocations {
                    locations(first: 1) {
                        nodes {
                            id
                            name
                        }
                    }
                }`
            );
            const locationData = await locationResponse.json() as any;
            const locationNode = locationData.data?.locations?.nodes?.[0];
            const locationId = locationNode?.id;
            const locationName = locationNode?.name;

            // 2. Prepare Variants
            const handle = "bulk-edit-demo-product-" + Math.floor(Math.random() * 10000);

            const variant1: any = {
                optionValues: [
                    { optionName: "Color", name: "Red" },
                    { optionName: "Size", name: "Small" }
                ],
                price: "100.00",
                compareAtPrice: "150.00"
            };
            const variant2: any = {
                optionValues: [
                    { optionName: "Color", name: "Blue" },
                    { optionName: "Size", name: "Medium" }
                ],
                price: "120.00",
                compareAtPrice: "160.00"
            };
            const variant3: any = {
                optionValues: [
                    { optionName: "Color", name: "Green" },
                    { optionName: "Size", name: "Large" }
                ],
                price: "100.00",
                compareAtPrice: "150.00"
            };

            if (locationId) {
                variant1.inventoryQuantities = [{ quantity: 50, locationId, name: "available" }];
                variant2.inventoryQuantities = [{ quantity: 50, locationId, name: "available" }];
                variant3.inventoryQuantities = [{ quantity: 50, locationId, name: "available" }];
            }

            // 3. Create Product
            const response = await admin.graphql(
                `#graphql
                mutation createDemoProduct($input: ProductSetInput!) {
                    productSet(input: $input) {
                        product {
                            id
                            title
                            handle
                            variants(first: 5) {
                                nodes {
                                    id
                                    title
                                }
                            }
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                {
                    variables: {
                        input: {
                            title: "Bulk edit - Demo product",
                            handle: handle,
                            status: "DRAFT",
                            descriptionHtml: "<p>This is a demo product created for testing purposes.</p>",
                            tags: ["bulk-demo", "price-editor-demo"],
                            productOptions: [
                                { name: "Color", values: [{ name: "Red" }, { name: "Blue" }, { name: "Green" }] },
                                { name: "Size", values: [{ name: "Small" }, { name: "Medium" }, { name: "Large" }] }
                            ],
                            variants: [variant1, variant2, variant3]
                        }
                    }
                }
            );

            const data = await response.json();
            const product = data.data?.productSet?.product;
            const userErrors = data.data?.productSet?.userErrors;

            if (userErrors && userErrors.length > 0) {
                return { ok: false, errors: userErrors };
            }

            return { ok: true, product };

        } catch (error) {
            console.error("Failed to create demo product", error);
            return { ok: false, error: "Failed to create demo product" };
        }
    }

    if (intent === "create-metafield-definition") {
        const { admin } = await authenticate.admin(request);
        const name = formData.get("name") as string;
        const namespace = formData.get("namespace") as string;
        const key = formData.get("key") as string;
        const type = formData.get("type") as string;
        const ownerType = formData.get("ownerType") as string; // PRODUCT or PRODUCTVARIANT
        const description = formData.get("description") as string || "";

        try {
            const response = await admin.graphql(
                `#graphql
                mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
                    metafieldDefinitionCreate(definition: $definition) {
                        createdDefinition {
                            id
                            name
                            namespace
                            key
                            type {
                                name
                            }
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                {
                    variables: {
                        definition: {
                            name,
                            namespace,
                            key,
                            type,
                            ownerType, // "PRODUCT" or "PRODUCTVARIANT"
                            description,
                            access: {
                                storefront: "PUBLIC_READ",
                                admin: "MERCHANT_READ_WRITE"
                            }
                        }
                    }
                }
            );

            const data = await response.json();
            const createdDefinition = data.data?.metafieldDefinitionCreate?.createdDefinition;
            const userErrors = data.data?.metafieldDefinitionCreate?.userErrors;

            if (userErrors && userErrors.length > 0) {
                return { ok: false, error: userErrors[0].message };
            }

            return { ok: true, definition: createdDefinition };

        } catch (error) {
            console.error("Failed to create metafield definition", error);
            return { ok: false, error: "Failed to create metafield definition" };
        }
    }

    if (intent === "toggle-metafield-favorite") {
        const { session } = await authenticate.admin(request);
        const namespace = formData.get("namespace") as string;
        const key = formData.get("key") as string;
        const type = formData.get("type") as string;
        const target = formData.get("target") as string;
        const isFavorite = formData.get("isFavorite") === "true";

        if (isFavorite) {
            // Remove from favorites
            await prisma.metafieldFavorite.delete({
                where: {
                    shop_target_namespace_key: {
                        shop: session.shop,
                        target,
                        namespace,
                        key
                    }
                }
            });
            return { ok: true, message: "Removed from favorites" };
        } else {
            // Add to favorites
            await prisma.metafieldFavorite.upsert({
                where: {
                    shop_target_namespace_key: {
                        shop: session.shop,
                        target,
                        namespace,
                        key
                    }
                },
                update: { type },
                create: {
                    shop: session.shop,
                    target,
                    namespace,
                    key,
                    type
                }
            });
            return { ok: true, message: "Added to favorites" };
        }
    }

    if (intent === "save-preset") {
        const { session } = await authenticate.admin(request);
        const shop = session.shop;
        const name = formData.get("name") as string;
        const namespace = formData.get("namespace") as string;
        const key = formData.get("key") as string;
        const type = formData.get("type") as string;
        const target = formData.get("target") as string;

        await prisma.metafieldPreset.create({
            data: {
                shopDomain: shop,
                name,
                namespace,
                key,
                type,
                target
            }
        });
        return { status: "success", message: "Preset saved" };
    }

    if (intent === "delete-preset") {
        const id = formData.get("id") as string;
        await prisma.metafieldPreset.delete({
            where: { id }
        });
        return { status: "success", message: "Preset deleted" };
    }

    if (intent === "save-metafield-recent") {
        const { session } = await authenticate.admin(request);
        const namespace = formData.get("namespace") as string;
        const key = formData.get("key") as string;
        const type = formData.get("type") as string;
        const target = formData.get("target") as string;

        await prisma.metafieldRecent.upsert({
            where: {
                shop_target_namespace_key_compound_id: {
                    shop: session.shop,
                    target,
                    namespace,
                    key
                }
            },
            update: {
                type,
                lastUsedAt: new Date()
            },
            create: {
                shop: session.shop,
                target,
                namespace,
                key,
                type,
                lastUsedAt: new Date()
            }
        });

        // Maintain top 20
        const countData = await prisma.metafieldRecent.findMany({
            where: { shop: session.shop },
            select: { id: true },
            orderBy: { lastUsedAt: 'desc' }
        });
        if (countData && countData.length > 20) {
            const idsToDelete = countData.slice(20).map((i: any) => i.id);
            await prisma.metafieldRecent.deleteMany({
                where: { id: { in: idsToDelete } }
            });
        }

        return { ok: true };
    }

    if (intent === "save-metafield-preset") {
        const { session } = await authenticate.admin(request);
        const name = formData.get("presetName") as string;
        const namespace = formData.get("namespace") as string;
        const key = formData.get("key") as string;
        const type = formData.get("type") as string;
        const target = formData.get("target") as string; // "product" or "variant"

        await prisma.metafieldPreset.create({
            data: {
                shopDomain: session.shop,
                name: name,
                namespace,
                key,
                type,
                target
            }
        });

        return { ok: true, message: "Preset saved" };
    }

    if (intent === "create-task") {
        const { session } = await authenticate.admin(request);
        const shop = session.shop;

        const { features } = await getShopPlan(shop);

        const taskName = formData.get("taskName") as string;
        const configuration = JSON.parse(formData.get("configuration") as string);

        // Gating Check
        const field = configuration.fieldToEdit;
        // Map field if needed? fieldToEdit values match features list (lowercase underscore).
        if (!features.includes(field)) {
            return { ok: false, error: `Upgrade to Pro to edit ${field.replace('_', ' ')}.` };
        }
        const startTime = formData.get("startTime") as string;
        const note = formData.get("note") as string;
        const scheduleRevert = formData.get("scheduleRevert") === "true";
        const revertTime = formData.get("revertTime") as string;

        const ianaTimezone = formData.get("ianaTimezone") as string || "UTC";

        const getOffset = (tz: string) => {
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    timeZoneName: 'longOffset'
                }).formatToParts(new Date());
                const offset = parts.find(p => p.type === 'timeZoneName')?.value || "";
                // Handle "GMT+5:30" -> "+05:30", "GMT-8" -> "-08:00", etc.
                let clean = offset.replace("GMT", "");
                if (clean === "UTC") return "+00:00";
                if (!clean) return "+00:00";

                // Ensure format is +HH:mm or -HH:mm
                const match = clean.match(/([+-])(\d+):?(\d+)?/);
                if (match) {
                    const sign = match[1];
                    const hours = match[2].padStart(2, '0');
                    const mins = (match[3] || "00").padStart(2, '0');
                    return `${sign}${hours}:${mins}`;
                }
                return "+00:00";
            } catch (e) {
                return "+00:00";
            }
        };

        const tzOffset = getOffset(ianaTimezone);

        // Calculate start_time ISO string
        let startIso = new Date().toISOString();
        if (startTime === 'schedule') {
            const sDate = formData.get("scheduledStartDate") as string;
            const sTime = formData.get("scheduledStartTime") as string;
            if (sDate && sTime) {
                startIso = new Date(`${sDate}T${sTime}${tzOffset}`).toISOString();
            }
        }

        let endIso = null;
        if (scheduleRevert) {
            const rDate = formData.get("scheduledRevertDate") as string;
            const rTime = formData.get("scheduledRevertTime") as string;
            if (rDate && rTime) {
                endIso = new Date(`${rDate}T${rTime}${tzOffset}`).toISOString();
            }
        }

        const editJobId = formData.get("editJobId") as string;

        let currentJob = null;
        if (editJobId) {
            currentJob = await prisma
                .priceJob
                .update({
                    where: {
                        jobId: editJobId,
                        shopDomain: shop
                    },
                    data: {
                        name: taskName,
                        status: (startTime === 'now') ? 'scheduled' : (startTime === 'manual' ? 'pending' : 'scheduled'),
                        startTime: new Date(startIso),
                        endTime: endIso ? new Date(endIso) : null,
                        configuration: configuration as any,
                        previewJson: formData.get("previewJson") ? JSON.parse(formData.get("previewJson") as string) : undefined,
                        note: note,
                    }
                });

            // Sync with tasks table
            await prisma.task.upsert({
                where: { id: editJobId },
                update: {
                    shop: shop,
                    taskName: taskName,
                    field: configuration.fieldToEdit,
                    configuration: configuration as any
                },
                create: {
                    id: editJobId,
                    shop: shop,
                    taskName: taskName,
                    field: configuration.fieldToEdit,
                    configuration: configuration as any
                }
            });

            // Sync with specialized config tables
            await syncSpecializedConfig(prisma, editJobId, configuration, true);
        } else {
            const isScheduled = startTime === 'schedule';
            const isScheduledRevert = scheduleRevert && endIso;
            const scheduledDateTime = startIso;
            const revertDateTime = endIso;

            const productsCount = parseInt(formData.get("productsCount") as string) || 0; console.log("DEBUG ACTION productsCount:", productsCount);

            // DEBUG TO FILE
            import('fs').then(fs => {
                fs.appendFileSync('debug_log.txt', `\n[${new Date().toISOString()}] ACTION: Received productsCount: ${productsCount}, Raw: ${formData.get("productsCount")}\n`);
            });

            currentJob = await prisma.priceJob.create({
                data: {
                    shopDomain: shop,
                    name: taskName,
                    status: (startTime === 'now') ? 'scheduled' : (startTime === 'manual' ? 'pending' : 'scheduled'),
                    startTime: new Date(startIso),
                    endTime: endIso ? new Date(endIso) : null,
                    configuration: configuration as any,
                    note: note,
                    previewJson: formData.get("previewJson") ? JSON.parse(formData.get("previewJson") as string) : [],
                    revertStatus: isScheduledRevert ? "scheduled" : null,
                    scheduledRevertAt: isScheduledRevert && revertDateTime ? new Date(revertDateTime) : null,
                    totalProducts: productsCount
                }
            });

            const jobId = currentJob.jobId;

            // Save to tasks table as well
            await prisma.task.create({
                data: {
                    id: jobId,
                    shop: shop,
                    taskName: taskName,
                    field: configuration.fieldToEdit,
                    configuration: configuration as any
                }
            });

            // Sync specialized config for background processing performance
            await syncSpecializedConfig(prisma, jobId, configuration, false);

            // Track Funnel Event: task_created
            await trackEvent(shop, 'task_created', { jobId, isScheduled });

            // --- EMAIL NOTIFICATIONS ---
            try {
                const settings = await prisma.shopSettings
                    .findUnique({
                        where: { shopDomain: shop },
                        select: { contactEmail: true, shopName: true }
                    });

                if (settings?.contactEmail) {
                    let shopCurrency = "$";
                    try {
                        const shopRes = await admin.graphql(`{ shop { currencyCode } }`);
                        const shopData = await shopRes.json() as any;
                        const currencyCode = shopData.data?.shop?.currencyCode || "USD";
                        const currencySymbols: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
                        shopCurrency = currencySymbols[currencyCode] || currencySymbols["USD"];
                    } catch (e) { }

                    const descriptions = getTaskDescriptionList(configuration, "$");
                    const editingRules = descriptions.join(" • ");
                    const appliesTo = getAppliesToText(configuration);
                    const fullDescription = [...descriptions, appliesTo].join(" • ");

                    // 1. Task Scheduled Email
                    if (startTime === 'schedule') {
                        await sendTaskScheduledEmail({
                            taskName: taskName,
                            taskId: currentJob.jobId,
                            scheduledAt: currentJob.startTime ? new Date(currentJob.startTime).toLocaleString() : new Date().toLocaleString(),
                            shopName: settings.shopName || shop,
                            shopDomain: shop,
                            toEmail: settings.contactEmail,
                            description: fullDescription,
                            editingRules,
                            appliesTo
                        });
                    }

                    // 2. Revert Scheduled Email (if applicable)
                    if (scheduleRevert && endIso) {
                        await sendRevertScheduledEmail({
                            taskName: taskName,
                            taskId: currentJob.jobId,
                            scheduledAt: new Date(endIso).toLocaleString(),
                            shopName: settings.shopName || shop,
                            shopDomain: shop,
                            toEmail: settings.contactEmail,
                            description: fullDescription,
                            editingRules,
                            appliesTo
                        });
                    }
                }
            } catch (emailErr) {
                console.error("Failed to send creation notifications:", emailErr);
            }
        }

        // Trigger job processing immediately (fire and forget)
        processPendingJobs().catch(console.error);

        return redirect(`/app/tasks`);
    }

    return null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    // Parallelize all data fetching
    const [response, metafieldPresets, metafieldFavorites, metafieldRecent, shopSettings, planInfo, editJob, fallbackTagsResponse] = await Promise.all([
        // 1. GraphQL Metadata
        (async () => {
            try {
                return await admin.graphql(
            `#graphql
                publications(first: 250) {
                    edges {
                        node {
                            id
                            name
                        }
                    }
                }
                markets(first: 250) {
                    nodes {
                        id
                        name
                        handle
                    }
                }
                shop {
                    currencyCode
                    ianaTimezone
                    productTypes(first: 250) {
                        nodes
                    }
                    productVendors(first: 250) {
                        nodes
                    }
                    productTags(first: 250) {
                        nodes
                    }
                }
                collections(first: 250) {
                    nodes {
                        id
                        title
                    }
                }
                productsCount(query: "", limit: null) {
                    count
                }

                productMetafieldDefinitions: metafieldDefinitions(first: 250, ownerType: PRODUCT) {
                    nodes {
                        id
                        name
                        namespace
                        key
                        type {
                            name
                        }
                    }
                }
                variantMetafieldDefinitions: metafieldDefinitions(first: 250, ownerType: PRODUCTVARIANT) {
                    nodes {
                        id
                        name
                        namespace
                        key
                        type {
                            name
                        }
                    }
                }
            }`
                );
            } catch (e) {
                console.error("DEBUG LOADER: Metadata GraphQL error:", e);
                return null;
            }
        })(),

        // 2. Metafield Presets
        prisma.metafieldPreset.findMany({
            where: { shopDomain: shop },
            orderBy: { createdAt: 'desc' }
        }),

        // 3. Metafield Favorites
        prisma.metafieldFavorite.findMany({
            where: { shop: shop },
            orderBy: { createdAt: 'desc' }
        }),

        // 4. Metafield Recent
        prisma.metafieldRecent.findMany({
            where: { shop: shop },
            orderBy: { lastUsedAt: 'desc' },
            take: 20
        }),

        // 5. Shop Settings
        prisma.shopSettings.findUnique({
            where: { shopDomain: shop }
        }),

        // 6. Shop Plan & Features
        getShopPlan(session.shop),

        // 7. Edit Job (if exists)
        (async () => {
            const url = new URL(request.url);
            const editJobId = url.searchParams.get("edit");
            if (editJobId) {
                return prisma.priceJob.findUnique({
                    where: {
                        jobId: editJobId,
                        shopDomain: shop
                    }
                });
            }
            return null;
        })(),

        // 8. Fallback Tags (Products query) - resilient to rate limits
        (async () => {
            try {
                const res1 = await admin.graphql(`query { products(first: 250) { edges { node { tags } } } }`);
                const data1 = await res1.json() as any;
                const pageInfo = data1.data?.products?.pageInfo;
                let data2: any = null;
                if (pageInfo?.hasNextPage) {
                    const res2 = await admin.graphql(`query($cursor: String) { products(first: 250, after: $cursor) { edges { node { tags } } } }`, {
                        variables: { cursor: pageInfo.endCursor }
                    });
                    data2 = await res2.json();
                }
                return { data1, data2 };
            } catch (e) {
                console.warn("Fallback tag fetch failed (rate limit?):", e);
                return null;
            }
        })()
    ]);

    const { plan: shopPlan, features: shopFeatures, featureFlags } = planInfo;

    const responseJson: any = response ? await response.json() : { data: null };
    console.log("DEBUG LOADER: Metadata response:", JSON.stringify(responseJson.data?.productsCount));

    if (responseJson.errors) {
        console.error("DEBUG LOADER: Metadata errors:", JSON.stringify(responseJson.errors));
    }

    // Fetch available locations for inventory tasks
    let locationsData: any = { data: { locations: { nodes: [] } } };
    try {
        const locationsResponse = await admin.graphql(
            `#graphql
            query getLocations {
                locations(first: 20) {
                    nodes {
                        id
                        name
                    }
                }
            }`
        );
        locationsData = await locationsResponse.json();
    } catch (e) {
        console.error("DEBUG LOADER: Locations fetch failed:", e);
    }
    const locations = locationsData.data?.locations?.nodes?.map((n: any) => ({ label: n.name, value: n.id })) || [];

    return {
        apiKey: process.env.SHOPIFY_API_KEY || "",
        locations,
        markets: responseJson.data?.markets?.nodes || [],
        shop: responseJson.data?.shop || { currencyCode: "USD", ianaTimezone: "UTC" },
        productsCount: responseJson.data?.productsCount?.count || 0,
        collections: responseJson.data?.collections?.nodes || [],
        productTypes: responseJson.data?.shop?.productTypes?.nodes || [],
        productVendors: responseJson.data?.shop?.productVendors?.nodes || [],
        productTags: (() => {
            const rawShopTags = responseJson.data?.shop?.productTags;
            const fallbackData = fallbackTagsResponse as any;

            const shopTags = new Set<string>((rawShopTags?.nodes || []) as string[]);

            // Process first batch of fallback
            const data1Edges = fallbackData?.data1?.data?.products?.edges || [];
            data1Edges.forEach((e: any) => {
                (e.node?.tags || []).forEach((t: string) => shopTags.add(t));
            });

            // Process second batch if available
            const data2Edges = fallbackData?.data2?.data?.products?.edges || [];
            data2Edges.forEach((e: any) => {
                (e.node?.tags || []).forEach((t: string) => shopTags.add(t));
            });

            const finalTags = Array.from(shopTags).sort();
            return finalTags;
        })(),
        productMetafieldDefinitions: responseJson.data?.productMetafieldDefinitions?.nodes || [],
        variantMetafieldDefinitions: responseJson.data?.variantMetafieldDefinitions?.nodes || [],
        metafieldPresets: metafieldPresets || [],
        metafieldFavorites: metafieldFavorites || [],
        metafieldRecent: metafieldRecent || [],
        publications: responseJson.data?.publications?.edges?.map((e: any) => e.node) || [],
        editJob: editJob,
        shopFeatures,
        shopPlan,
        featureFlags: featureFlags || {}
    };
};

// --- Metafield Condition Picker ---
function MetafieldConditionPicker({
    selectedNamespace,
    selectedKey,
    onChange,
    productDefinitions,
    variantDefinitions
}: {
    selectedNamespace?: string,
    selectedKey?: string,
    onChange: (ns: string, key: string, type: string, ownerType: string) => void,
    productDefinitions: any[],
    variantDefinitions: any[]
}) {
    const [active, setActive] = useState(false);
    const [context, setContext] = useState<"product" | "variant">("product");
    const [filterType, setFilterType] = useState("all");
    const [search, setSearch] = useState("");

    const definitions = context === 'product' ? productDefinitions : variantDefinitions;

    // Extract unique types for the filter dropdown
    const typeOptions = useMemo(() => {
        const types = new Set(definitions.map((d: any) => d.type?.name));
        return [{ label: "All types", value: "all" }, ...Array.from(types).filter(Boolean).sort().map((t: any) => ({ label: t, value: t }))];
    }, [definitions]);

    const filteredDefinitions = useMemo(() => {
        return definitions.filter((def: any) => {
            if (filterType !== 'all' && def.type?.name !== filterType) return false;
            if (search) {
                const q = search.toLowerCase();
                return (def.name || "").toLowerCase().includes(q) ||
                    def.namespace.toLowerCase().includes(q) ||
                    def.key.toLowerCase().includes(q);
            }
            return true;
        });
    }, [definitions, filterType, search]);

    // Find current selected name for display
    const selectedDef = [...productDefinitions, ...variantDefinitions].find((d: any) => d.namespace === selectedNamespace && d.key === selectedKey);
    const displayValue = selectedNamespace && selectedKey ? `${selectedDef?.name || selectedKey} (${selectedNamespace}.${selectedKey})` : "";

    const activator = (
        <div onClick={() => setActive(!active)}>
            <TextField
                label="Metafield"
                labelHidden
                value={displayValue}
                placeholder="Select metafield..."
                autoComplete="off"
                prefix={<Icon source={SearchIcon} />}
                readonly
            />
        </div>
    );

    return (
        <Popover
            active={active}
            activator={activator}
            onClose={() => setActive(false)}
            autofocusTarget="first-node"
            fullWidth
            preferredAlignment="left"
        >
            <Box padding="300" minHeight="300px" width="300px">
                <BlockStack gap="300">
                    {/* Header Controls */}
                    <BlockStack gap="200">
                        <InlineStack gap="300">
                            <RadioButton
                                label="Product"
                                checked={context === 'product'}
                                id="picker_context_product"
                                name="picker_context"
                                onChange={() => setContext('product')}
                            />
                            <RadioButton
                                label="Variant"
                                checked={context === 'variant'}
                                id="picker_context_variant"
                                name="picker_context"
                                onChange={() => setContext('variant')}
                            />
                        </InlineStack>

                        <Select
                            label="Filter by type"
                            labelHidden
                            options={typeOptions}
                            value={filterType}
                            onChange={setFilterType}
                            placeholder="Type"
                        />

                        <TextField
                            label="Search"
                            labelHidden
                            value={search}
                            onChange={setSearch}
                            autoComplete="off"
                            placeholder="Search definition..."
                            prefix={<Icon source={SearchIcon} />}
                            clearButton
                            onClearButtonClick={() => setSearch("")}
                        />
                    </BlockStack>

                    <Divider />

                    {/* List */}
                    <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                        {filteredDefinitions.length === 0 ? (
                            <Box padding="200"><Text as="p" tone="subdued">No definitions found.</Text></Box>
                        ) : (
                            <BlockStack gap="100">
                                {filteredDefinitions.map((def: any) => (
                                    <div
                                        key={def.id}
                                        onClick={() => {
                                            onChange(def.namespace, def.key, def.type?.name, context === 'product' ? 'PRODUCT' : 'PRODUCTVARIANT');
                                            setActive(false);
                                        }}
                                        style={{
                                            padding: '8px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            background: (selectedNamespace === def.namespace && selectedKey === def.key) ? 'var(--p-color-bg-surface-hover)' : 'transparent'
                                        }}
                                        className="hover:bg-gray-50"
                                    >
                                        <BlockStack gap="050">
                                            <InlineStack align="space-between">
                                                <Text as="span" fontWeight="bold">{def.name}</Text>
                                                <Badge tone="info">{def.type?.name}</Badge>
                                            </InlineStack>
                                            <Text as="span" tone="subdued" variant="bodySm">{def.namespace}.{def.key}</Text>
                                        </BlockStack>
                                    </div>
                                ))}
                            </BlockStack>
                        )}
                    </div>
                </BlockStack>
            </Box>
        </Popover>
    );
}

interface Condition {
    property: string;
    operator: string;
    value: string;
    metafieldKey?: string;
    metafieldNamespace?: string;
    originalKey?: string;
    metafieldType?: string;
    metafieldOwnerType?: string;
    [key: string]: any;
}

// --- Custom Time Picker ---
function TimePickerContent({ value, onChange }: { value: string, onChange: (val: string) => void }) {
    const [hour24, minuteStr] = (value || "00:00").split(':');
    const h24 = parseInt(hour24);
    const hour12 = h24 % 12 || 12;
    const period = h24 < 12 ? 'AM' : 'PM';

    const hours = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
    const periods = ['AM', 'PM'];

    const hourRef = useRef<HTMLDivElement>(null);
    const minuteRef = useRef<HTMLDivElement>(null);
    const periodRef = useRef<HTMLDivElement>(null);

    // Manual scroll function to avoid "jump to top" glitch caused by scrollIntoView
    const syncScroll = useCallback((ref: React.RefObject<HTMLDivElement>) => {
        if (ref.current) {
            const selected = ref.current.querySelector('.time-picker-item-selected') as HTMLElement;
            if (selected) {
                const container = ref.current;
                // Center the selected item in the visible area of the column
                const scrollPos = selected.offsetTop - container.offsetTop - (container.clientHeight / 2) + (selected.clientHeight / 2);
                container.scrollTop = scrollPos;
            }
        }
    }, []);

    // Scroll on mount or when value changes
    useEffect(() => {
        const timer = setTimeout(() => {
            syncScroll(hourRef);
            syncScroll(minuteRef);
            syncScroll(periodRef);
        }, 0);
        return () => clearTimeout(timer);
    }, [value, syncScroll]);

    const handleSelect = (newHour: string, newMinute: string, newPeriod: string) => {
        let h = parseInt(newHour);
        if (newPeriod === 'PM' && h < 12) h += 12;
        if (newPeriod === 'AM' && h === 12) h = 0;
        onChange(`${h.toString().padStart(2, '0')}:${newMinute}`);
    };

    return (
        <Box padding="200" width="220px">
            <InlineStack gap="100" wrap={false} align="center">
                {/* Hours */}
                <BlockStack gap="100">
                    <Box paddingInlineStart="100">
                        <Text as="span" variant="bodyXs" fontWeight="bold" tone="subdued">HR</Text>
                    </Box>
                    <div className="time-picker-column" ref={hourRef}>
                        <BlockStack gap="0">
                            {hours.map(h => (
                                <div
                                    key={h}
                                    className={`time-picker-item ${parseInt(h) === hour12 ? 'time-picker-item-selected' : ''}`}
                                    onClick={() => handleSelect(h, minuteStr, period)}
                                >
                                    <Text as="span">{h}</Text>
                                </div>
                            ))}
                        </BlockStack>
                    </div>
                </BlockStack>
                {/* Minutes */}
                <BlockStack gap="100">
                    <Box paddingInlineStart="100">
                        <Text as="span" variant="bodyXs" fontWeight="bold" tone="subdued">MIN</Text>
                    </Box>
                    <div className="time-picker-column" ref={minuteRef}>
                        <BlockStack gap="0">
                            {minutes.map(m => (
                                <div
                                    key={m}
                                    className={`time-picker-item ${m === minuteStr ? 'time-picker-item-selected' : ''}`}
                                    onClick={() => handleSelect(hour12.toString().padStart(2, '0'), m, period)}
                                >
                                    <Text as="span">{m}</Text>
                                </div>
                            ))}
                        </BlockStack>
                    </div>
                </BlockStack>
                {/* Periods */}
                <BlockStack gap="100">
                    <Box paddingInlineStart="100">
                        <Text as="span" variant="bodyXs" fontWeight="bold" tone="subdued">AM/PM</Text>
                    </Box>
                    <div className="time-picker-column time-picker-period-column" ref={periodRef}>
                        <BlockStack gap="0">
                            {periods.map(p => (
                                <div
                                    key={p}
                                    className={`time-picker-item ${p === period ? 'time-picker-item-selected' : ''}`}
                                    onClick={() => handleSelect(hour12.toString().padStart(2, '0'), minuteStr, p)}
                                >
                                    <Text as="span">{p}</Text>
                                </div>
                            ))}
                        </BlockStack>
                    </div>
                </BlockStack>
            </InlineStack>
        </Box>
    );
}

export default function CreateTaskPage() {
    const {
        apiKey,
        shop,
        editJob,
        locations,
        markets,
        productsCount,
        collections,
        productTypes,
        productVendors,
        productTags,
        productMetafieldDefinitions,
        variantMetafieldDefinitions,
        metafieldPresets,
        metafieldFavorites,
        metafieldRecent,
        publications,
        shopFeatures,
        shopPlan,
        featureFlags
    } = useLoaderData<typeof loader>();
    const isV2Enabled = featureFlags?.enable_full_product_edit_v2 === true;

    // DEBUG RENDER
    console.log("DEBUG RENDER: productsCount from loader:", productsCount);
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const fetcher = useFetcher();
    const demoFetcher = useFetcher<any>();
    const createDefFetcher = useFetcher<any>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const actionData = useActionData<any>();

    // Improved local currency lookup for better resilience
    const getCurrencySymbolLocal = (code: string | undefined | null) => {
        if (!code) return "$"; // Default to $ if code is missing to avoid "undefined "
        const symbols: { [key: string]: string } = {
            'USD': '$',
            'EUR': '€',
            'GBP': '£',
            'INR': '₹',
            'AUD': 'A$',
            'CAD': 'C$',
            'JPY': '¥',
            'NZD': 'NZ$',
            'SGD': 'S$',
            'HKD': 'HK$',
            'CHF': 'CHF',
            'SEK': 'kr',
            'NOK': 'kr',
            'DKK': 'kr',
            'ZAR': 'R',
            'BRL': 'R$',
            'RUB': '₽',
            'KRW': '₩',
            'CNY': '¥',
            'MXN': '$',
            'SAR': '﷼',
            'AED': 'د.إ',
            'ILS': '₪',
            'PLN': 'zł',
            'TRY': '₺'
        };
        const symbol = symbols[code];
        if (symbol) return symbol;
        
        // Return code if no symbol found, but ensure it's not "undefined"
        return code ? code + " " : "$";
    };

    const initialType = searchParams.get("type") || "price";

    // Form State
    const [taskName, setTaskName] = useState("New task");
    const [fieldToEdit, setFieldToEdit] = useState(initialType);
    const [editMethod, setEditMethod] = useState(
        initialType === 'tags' ? 'add_tags' : 
        initialType === 'vendor' ? 'set_vendor' :
        'fixed'
    );
    const [editValue, setEditValue] = useState("");
    const [rounding, setRounding] = useState("nearest_01");
    const [roundingValue, setRoundingValue] = useState("");
    const [compareAtPriceOption, setCompareAtPriceOption] = useState("none");
    const [compareAtEditMethod, setCompareAtEditMethod] = useState("fixed");
    const [compareAtEditValue, setCompareAtEditValue] = useState("");
    const [applyToMarkets, setApplyToMarkets] = useState(false);
    const [applyToProducts, setApplyToProducts] = useState("all");
    const [excludeSpecificProducts, setExcludeSpecificProducts] = useState(false);
    const [applyToVariants, setApplyToVariants] = useState("all");
    const [startTime, setStartTime] = useState("now");
    const [scheduleRevert, setScheduleRevert] = useState(false);
    const [addTags, setAddTags] = useState(false);
    const [tagsToAdd, setTagsToAdd] = useState<string[]>([]);
    const [removeTags, setRemoveTags] = useState(false);
    const [tagsToRemove, setTagsToRemove] = useState<string[]>([]);
    const [note, setNote] = useState("");
    const [weightUnit, setWeightUnit] = useState("kg");
    const [findText, setFindText] = useState("");
    const [replaceText, setReplaceText] = useState("");

    // Metafield State
    const [metafieldMode, setMetafieldMode] = useState(0); // 0: Existing, 1: Create
    const [metafieldTarget, setMetafieldTarget] = useState("start"); // "start" for Product (Legacy choice list returns string[]) or "PRODUCT" string? Using Tab index or similar? Let's use string "PRODUCT" | "PRODUCTVARIANT"
    // Actually ChoiceList returns string[], but we want simple toggle. Let's use "product" | "variant"
    const [metafieldTargetType, setMetafieldTargetType] = useState<"product" | "variant">("product");

    const [metafieldNamespace, setMetafieldNamespace] = useState("custom");
    const [metafieldKey, setMetafieldKey] = useState("");
    const [showAdvancedMetafieldSettings, setShowAdvancedMetafieldSettings] = useState(false);
    const [metafieldType, setMetafieldType] = useState("single_line_text_field");
    const [metafieldDescription, setMetafieldDescription] = useState("");

    const [selectedDefinition, setSelectedDefinition] = useState<any>(null);
    const [metafieldSearchText, setMetafieldSearchText] = useState("");
    const [isDefinitionPopoverOpen, setIsDefinitionPopoverOpen] = useState(false);

    // UI Gating
    const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
    const [fieldSelectorActive, setFieldSelectorActive] = useState(false);

    const isFieldLocked = (field: string) => {
        let normalizedField = field;
        if (field.startsWith('metafield:')) normalizedField = 'metafield';
        else if (field.startsWith('publication:')) normalizedField = 'sales_channels';
        else if (field.startsWith('market_publish:')) normalizedField = 'market_publishing';
        else if (field.startsWith('market_price:')) normalizedField = 'market_price';
        
        return !shopFeatures.includes(normalizedField);
    };

    const toggleFieldSelector = useCallback(() => setFieldSelectorActive((active) => !active), []);

    const handleFieldChange = (val: string) => {
        if (isFieldLocked(val)) {
            setUpgradeModalOpen(true);
            setFieldSelectorActive(false);
            return;
        }

        let finalField = val;
        let nextMethod = 'fixed';
        let nextValue = '';

        if (val.startsWith('metafield:')) {
            const [, ns, key, type] = val.split(':');
            finalField = 'metafield';
            setMetafieldNamespace(ns);
            setMetafieldKey(key);
            setMetafieldType(type || 'single_line_text_field');
            setMetafieldMode(0); // Select existing mode
            setMetafieldTargetType('product'); // Default or inferred
            
            const defs = productMetafieldDefinitions;
            const found = defs.find((d: any) => d.namespace === ns && d.key === key);
            if (found) {
                setSelectedDefinition(found);
                setMetafieldSearchText(found.name);
            }
        } else if (val.startsWith('publication:')) {
            const id = val.split(':').slice(1).join(':');
            finalField = 'sales_channels';
            setEditValue(id);
            nextMethod = 'publish';
        } else if (val.startsWith('market_publish:')) {
            const id = val.split(':').slice(1).join(':');
            finalField = 'market_publishing';
            setEditValue(id);
            nextMethod = 'publish';
        } else if (val.startsWith('market_price:')) {
            const id = val.split(':').slice(1).join(':');
            finalField = 'price'; // We can map market price back to price field with market context
            setApplyToMarkets(true);
            setSelectedMarkets([id]);
            setApplyToBasePrice(false);
        }

        setFieldToEdit(finalField);

        if (finalField === 'tags') {
            nextMethod = 'add_tags';
        } else if (finalField === 'status') {
            nextValue = 'ACTIVE';
        } else if (finalField === 'inventory') {
            nextMethod = 'fixed';
            nextValue = '0';
        } else if (finalField === 'requires_shipping' || finalField === 'taxable') {
            nextValue = 'true';
        }

        setEditMethod(nextMethod);
        setEditValue(nextValue);
        setFieldSelectorActive(false);
    };

    const groupedFieldOptions = useMemo(() => {
        return [
            {
                title: "Product Fields",
                options: [
                    { label: "Title", value: "title", isPro: true },
                    { label: "Description", value: "body_html", isPro: true },
                    { label: "Handle", value: "handle", isPro: true },
                    { label: "Images / Media", value: "images", isPro: true },
                    { label: "Manual Collection", value: "manual_collection", isPro: true },
                    { label: "Option 1 Name", value: "option1_name", isPro: true },
                    { label: "Option 2 Name", value: "option2_name", isPro: true },
                    { label: "Option 3 Name", value: "option3_name", isPro: true },
                    { label: "Product Type", value: "product_type", isPro: true },
                    { label: "Status", value: "status" },
                    { label: "Vendor", value: "vendor", isPro: true },
                    { label: "Tags", value: "tags", isPro: true },
                    { label: "Template", value: "template_suffix", isPro: true },
                    { label: "SEO Title", value: "seo_title", isPro: true },
                    { label: "SEO Description", value: "seo_description", isPro: true },
                    { label: "Search visibility", value: "published", isPro: true },
                ]
            },
            {
                title: "Variant Fields",
                options: [
                    { label: "Price", value: "price" },
                    { label: "Compare at price", value: "compare_price" },
                    { label: "Cost", value: "cost" },
                    { label: "Inventory", value: "inventory", isPro: true },
                    { label: "SKU", value: "sku", isPro: true },
                    { label: "Barcode", value: "barcode", isPro: true },
                    { label: "Weight", value: "weight", isPro: true },
                    { label: "Weight Unit", value: "weight_unit", isPro: true },
                    { label: "Inventory Policy", value: "inventory_policy", isPro: true },
                    { label: "Track Quantity", value: "inventory_management", isPro: true },
                    { label: "Taxable", value: "taxable", isPro: true },
                    { label: "Requires Shipping", value: "requires_shipping", isPro: true },
                    { label: "HS Code", value: "hs_code", isPro: true },
                    { label: "Country of Origin", value: "country_of_origin", isPro: true },
                ]
            },
            {
                title: "Google Shopping",
                options: [
                    { label: "Product Category", value: "google_product_category", isPro: true },
                    { label: "Age Group", value: "google_age_group", isPro: true },
                    { label: "Gender", value: "google_gender", isPro: true },
                    { label: "Color", value: "google_color", isPro: true },
                    { label: "Size", value: "google_size", isPro: true },
                    { label: "Material", value: "google_material", isPro: true },
                    { label: "Pattern", value: "google_pattern", isPro: true },
                    { label: "Condition", value: "google_condition", isPro: true },
                    { label: "MPN", value: "google_mpn", isPro: true },
                    { label: "Brand", value: "google_brand", isPro: true },
                    { label: "Custom Label 0", value: "google_custom_label_0", isPro: true },
                    { label: "Custom Label 1", value: "google_custom_label_1", isPro: true },
                    { label: "Custom Label 2", value: "google_custom_label_2", isPro: true },
                    { label: "Custom Label 3", value: "google_custom_label_3", isPro: true },
                    { label: "Custom Label 4", value: "google_custom_label_4", isPro: true },
                ]
            },
            {
                title: "Product Metafields",
                options: [
                    ...(productMetafieldDefinitions.map((def: any) => ({
                        label: def.name,
                        value: `metafield:${def.namespace}:${def.key}:${def.type.name}`,
                        isPro: true
                    }))),
                    { label: "Custom Metafield", value: "metafield", isPro: true }
                ]
            },
            {
                title: "Sales Channel Publishing",
                options: publications.map((p: any) => ({
                    label: p.name,
                    value: `publication:${p.id}`,
                    isPro: true
                }))
            },
            {
                title: "Market / Catalog Publishing",
                options: (markets || []).map((m: any) => ({
                    label: m.name,
                    value: `market_publish:${m.id}`,
                    isPro: true
                }))
            },
            {
                title: "Market / Catalog Price",
                options: (markets || []).map((m: any) => ({
                    label: `${m.name} Price`,
                    value: `market_price:${m.id}`,
                    isPro: true
                }))
            },
            {
                title: "Search & Discovery",
                options: [
                    { label: "Complementary products", value: "metafield:shopify:complementary_products:product_reference", isPro: true },
                    { label: "Related products", value: "metafield:shopify:related_products:product_reference", isPro: true },
                    { label: "Search boost", value: "metafield:shopify:search_boost:single_line_text_field", isPro: true },
                    { label: "Recommendations", value: "metafield:shopify:recommendations:product_reference", isPro: true },
                ]
            },
            {
                title: "Actions",
                options: [
                    { label: "Add variants", value: "add_variants", isPro: true },
                    { label: "Add product option", value: "add_options", isPro: true },
                    { label: "Reorder options", value: "reorder_options", isPro: true },
                    { label: "Sort variants", value: "sort_variants", isPro: true },
                    { label: "Delete products", value: "delete_products", isPro: true },
                    { label: "Delete variants", value: "delete_variants", isPro: true },
                    { label: "Connect inventory locations", value: "connect_locations", isPro: true },
                ]
            }
        ];
    }, [productMetafieldDefinitions, publications, markets]);

    const getFieldLabel = (value: string) => {
        // First check static groups
        for (const group of groupedFieldOptions) {
            const found = group.options.find((o: any) => o.value === value);
            if (found) return found.label;
        }

        // Handle dynamic patterns if not in static list
        if (value.startsWith('metafield:')) {
            const [, ns, key] = value.split(':');
            return `${ns}.${key}`;
        }
        if (value.startsWith('publication:')) {
            const id = value.split(':').slice(1).join(':');
            const pub = publications.find((p: any) => p.id === id);
            return pub ? pub.name : "Publication";
        }
        if (value.startsWith('market_publish:')) {
            const id = value.split(':').slice(1).join(':');
            const m = markets.find((m: any) => m.id === id);
            return m ? `${m.name} Visibility` : "Market Status";
        }
        if (value.startsWith('market_price:')) {
            const id = value.split(':').slice(1).join(':');
            const m = markets.find((m: any) => m.id === id);
            return m ? `${m.name} Price` : "Market Price";
        }

        return value;
    };

    const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
    const [applyToBasePrice, setApplyToBasePrice] = useState(true);
    const [selectedPreviewMarket, setSelectedPreviewMarket] = useState("base");
    const [priceOption, setPriceOption] = useState("none"); // none, set
    const [priceEditMethod, setPriceEditMethod] = useState("fixed");
    const [priceEditValue, setPriceEditValue] = useState("");

    // Get the currency symbol for the currently selected preview market
    const currencySymbol = useMemo(() => {
        if (selectedPreviewMarket !== 'base' && selectedPreviewMarket !== 'empty') {
            const market = markets.find((m: any) => m.handle === selectedPreviewMarket);
            if (market?.regions?.nodes?.[0]?.currencyCode) {
                return getCurrencySymbolLocal(market.regions.nodes[0].currencyCode);
            }
        }
        return getCurrencySymbolLocal(shop?.currencyCode);
    }, [shop?.currencyCode, selectedPreviewMarket, markets]);

    const formatTo12Hour = useCallback((time24: string) => {
        if (!time24) return "";
        const [hours, minutes] = time24.split(':').map(Number);
        const h = hours % 12 || 12;
        const m = minutes.toString().padStart(2, '0');
        const period = hours < 12 ? 'AM' : 'PM';
        return `${h}:${m} ${period}`;
    }, []);

    const [removeTagInput, setRemoveTagInput] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
    const [metafieldView, setMetafieldView] = useState("all"); // all, favorites, recent, pinned, text, number, boolean, json
    const [metafieldViewPopoverActive, setMetafieldViewPopoverActive] = useState(false);
    const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

    // Selection Conditions State
    const [productConditions, setProductConditions] = useState<Condition[]>([{ property: "title", operator: "contains", value: "", metafieldKey: "" }]);
    const [variantConditions, setVariantConditions] = useState([{ property: "title", operator: "contains", value: "", metafieldKey: "" }]);
    const [productMatchLogic, setProductMatchLogic] = useState("all");
    const [variantMatchLogic, setVariantMatchLogic] = useState("all");
    const [selectedCollections, setSelectedCollections] = useState<any[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<any[]>([]);
    const [excludedProductsList, setExcludedProductsList] = useState<any[]>([]);

    // Scheduling State
    const getInitialTime = () => {
        const now = new Date();
        const hours = now.getHours();
        const minutes = Math.ceil(now.getMinutes() / 5) * 5;
        const finalHours = minutes >= 60 ? (hours + 1) % 24 : hours;
        const finalMinutes = minutes % 60;
        return `${finalHours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}`;
    };

    const [scheduledStartDate, setScheduledStartDate] = useState({
        start: new Date(),
        end: new Date()
    });
    const [{ month, year }, setDate] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });

    const [scheduledStartTime, setScheduledStartTime] = useState(getInitialTime());
    const [scheduledRevertDate, setScheduledRevertDate] = useState({
        start: new Date(),
        end: new Date()
    });
    const [scheduledRevertTime, setScheduledRevertTime] = useState(getInitialTime());

    const [locationId, setLocationId] = useState(locations?.[0]?.value || "");

    // Populate state from editJob
    useEffect(() => {
        if (editJob) {
            const config = editJob.configuration || {};
            setTaskName(editJob.name || "New task");
            setFieldToEdit(config.fieldToEdit || "price");
            setEditMethod(config.editMethod || "fixed");
            setEditValue(config.editValue || "");
            setLocationId(config.locationId || locations?.[0]?.value || "");
            setRounding(config.rounding || "none");
            setRoundingValue(config.roundingValue || "");
            setCompareAtPriceOption(config.compareAtPriceOption || "none");
            setCompareAtEditMethod(config.compareAtEditMethod || "fixed");
            setCompareAtEditValue(config.compareAtEditValue || "");
            setPriceOption(config.priceOption || "none");
            setPriceEditMethod(config.priceEditMethod || "fixed");
            setPriceEditValue(config.priceEditValue || "");
            setApplyToMarkets(config.applyToMarkets || false);
            setSelectedMarkets(config.selectedMarkets || []);
            setApplyToBasePrice(config.applyToBasePrice ?? true);
            setApplyToProducts(config.applyToProducts || "all");
            setApplyToVariants(config.applyToVariants || "all");
            setExcludeSpecificProducts(config.excludeSpecificProducts || false);
            setAddTags(config.addTags || false);
            setTagsToAdd(config.tagsToAdd || []);
            setRemoveTags(config.removeTags || false);
            setTagsToRemove(config.tagsToRemove || []);
            setNote(editJob.note || "");
            setWeightUnit(config.weightUnit || "kg");
            setFindText(config.findText || "");
            setReplaceText(config.replaceText || "");

            if (config.productSelection === 'conditions') {
                setProductConditions(config.productConditions || [{ property: "title", operator: "contains", value: "", metafieldKey: "" }]);
                setProductMatchLogic(config.productMatchLogic || "all");
            }
            if (config.productSelection === 'collections') {
                setSelectedCollections(config.selectedCollections || []);
            }
            if (config.productSelection === 'specific') {
                setSelectedProducts(config.selectedProducts || []);
            }
            if (config.excludeSpecificProducts) {
                setExcludedProductsList(config.excludedProducts || []);
            }
            if (config.variantSelection === 'conditions') {
                setVariantConditions(config.variantConditions || [{ property: "title", operator: "contains", value: "", metafieldKey: "" }]);
                setVariantMatchLogic(config.variantMatchLogic || "all");
            }

            // Metafield handling
            if (config.fieldToEdit === 'metafield') {
                setMetafieldTargetType(config.metafieldTarget || 'product');
                setMetafieldNamespace(config.metafieldNamespace || "");
                setMetafieldKey(config.metafieldKey || "");
                setMetafieldType(config.metafieldType || "");

                const defs = config.metafieldTarget === 'product' ? productMetafieldDefinitions : variantMetafieldDefinitions;
                const found = defs.find((d: any) => d.namespace === config.metafieldNamespace && d.key === config.metafieldKey);
                if (found) {
                    setSelectedDefinition(found);
                    setMetafieldSearchText(found.name);
                } else {
                    setMetafieldSearchText(`${config.metafieldNamespace}.${config.metafieldKey}`);
                }
            }

            // Scheduling
            if (editJob.start_time) {
                const sDate = new Date(editJob.start_time);
                // Check if it's more than 1 minute in the future, if not, maybe it was "now"
                const now = new Date();
                if (sDate.getTime() > now.getTime() + 60000) {
                    setStartTime("schedule");
                    setScheduledStartDate({ start: sDate, end: sDate });
                    const h = sDate.getHours().toString().padStart(2, '0');
                    const m = sDate.getMinutes().toString().padStart(2, '0');
                    setScheduledStartTime(`${h}:${m}`);
                } else {
                    setStartTime("now");
                }
            }

            if (editJob.end_time) {
                setScheduleRevert(true);
                const rDate = new Date(editJob.end_time);
                setScheduledRevertDate({ start: rDate, end: rDate });
                const h = rDate.getHours().toString().padStart(2, '0');
                const m = rDate.getMinutes().toString().padStart(2, '0');
                setScheduledRevertTime(`${h}:${m}`);
            }
        }
    }, [editJob, productMetafieldDefinitions, variantMetafieldDefinitions]);

    // Save Preset Fetcher
    const savePresetFetcher = useFetcher<any>();

    useEffect(() => {
        if (savePresetFetcher.data?.ok) {
            window.shopify.toast.show("Preset saved");
            setIsPresetModalOpen(false);
            setPresetName("");
        }
    }, [savePresetFetcher.data]);

    // Filter definitions based on search, target and view
    const currentDefinitions = metafieldTargetType === 'product' ? (productMetafieldDefinitions || []) : (variantMetafieldDefinitions || []);
    const filteredDefinitions = currentDefinitions.filter((def: any) => {
        // 1. Search Query filter
        const query = metafieldSearchText.toLowerCase();
        const matchesQuery = def.name.toLowerCase().includes(query) ||
            def.namespace.toLowerCase().includes(query) ||
            def.key.toLowerCase().includes(query);

        if (!matchesQuery && metafieldSearchText) return false;

        // 2. View Filter
        if (metafieldView === 'all') return true;
        if (metafieldView === 'favorites') {
            return metafieldFavorites?.some((f: any) =>
                f.target === (metafieldTargetType === 'product' ? 'PRODUCT' : 'PRODUCTVARIANT') &&
                f.namespace === def.namespace &&
                f.key === def.key
            );
        }
        if (metafieldView === 'recent') {
            return metafieldRecent?.some((r: any) =>
                r.target === (metafieldTargetType === 'product' ? 'PRODUCT' : 'PRODUCTVARIANT') &&
                r.namespace === def.namespace &&
                r.key === def.key
            );
        }
        if (metafieldView === 'text') return def.type.name.includes('text');
        if (metafieldView === 'number') return def.type.name.includes('number') || def.type.name.includes('integer') || def.type.name.includes('decimal');
        if (metafieldView === 'boolean') return def.type.name === 'boolean';
        if (metafieldView === 'json') return def.type.name === 'json';

        return true;
    });

    const recentFetcher = useFetcher();
    const favoriteFetcher = useFetcher();

    const updateMetafieldState = (def: any) => {
        if (!def) return;
        setMetafieldNamespace(def.namespace);
        setMetafieldKey(def.key);
        setMetafieldType(def.type.name); // Store type name for method logic
        setSelectedDefinition(def);
        setMetafieldSearchText(def.name);

        // Track Recent
        const formData = new FormData();
        formData.append("intent", "save-metafield-recent");
        formData.append("namespace", def.namespace);
        formData.append("key", def.key);
        formData.append("type", def.type.name);
        formData.append("target", metafieldTargetType === 'product' ? "PRODUCT" : "PRODUCTVARIANT");
        recentFetcher.submit(formData, { method: "POST" });
    };

    /**
     * Helper to calculate updated metafield values based on type and method.
     */
    const calculateUpdatedMetafieldValue = useCallback(({
        originalValue,
        type,
        editMethod,
        inputValue
    }: {
        originalValue: string | null | undefined,
        type: string,
        editMethod: string,
        inputValue: string
    }) => {
        // Normalize missing values based on type
        let current = originalValue;
        if (current === null || current === undefined) {
            if (type === 'boolean') current = 'false';
            else if (type.includes('number') || type.includes('integer') || type.includes('decimal')) current = '0';
            else current = '';
        }

        if (editMethod === 'clear_value') return "";

        // Boolean Logic
        if (type === 'boolean') {
            if (editMethod === 'toggle_boolean') return current === 'true' ? 'false' : 'true';
            // Default/Fixed logic for boolean
            return (inputValue === 'false' || editMethod === 'fixed_false') ? 'false' : 'true';
        }

        // Number Logic
        if (type.includes('number') || type.includes('integer') || type.includes('decimal')) {
            const numCurrent = parseFloat(current) || 0;
            const numInput = parseFloat(inputValue) || 0;
            let result = numCurrent;

            if (editMethod === 'fixed') result = numInput;
            else if (editMethod === 'increase_number') result = numCurrent + numInput;
            else if (editMethod === 'decrease_number') result = numCurrent - numInput;
            else if (editMethod === 'increase_percent') result = numCurrent * (1 + numInput / 100);
            else if (editMethod === 'decrease_percent') result = numCurrent * (1 - numInput / 100);

            return type.includes('integer') ? Math.round(result).toString() : result.toString();
        }

        // Text/String Logic
        const textCurrent = current.toString();
        if (editMethod === 'fixed') return inputValue;
        if (editMethod === 'append_text') return textCurrent + inputValue;
        if (editMethod === 'prepend_text') return inputValue + textCurrent;
        if (editMethod === 'find_replace' || editMethod === 'replace_text') {
            if (!findText) return textCurrent;
            return textCurrent.split(findText).join(replaceText || "");
        }
        if (editMethod === 'to_uppercase') return textCurrent.toUpperCase();
        if (editMethod === 'to_lowercase') return textCurrent.toLowerCase();
        if (editMethod === 'to_titlecase') {
            return textCurrent.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
        }

        // Default Fallback
        return inputValue;
    }, [findText, replaceText]);

    const applyRounding = (value: number, method: string, rVal?: string): string => {
        if (method === 'none') return value.toFixed(2);
        if (method === 'nearest_01') return (Math.round(value * 100) / 100).toFixed(2);
        if (method === 'nearest_whole') return Math.round(value).toFixed(2);
        if (method === 'nearest_99') return (Math.floor(value) + 0.99).toFixed(2);
        if (method === 'custom_ending') {
            let decimalPart = 0.99;
            if (rVal) {
                const parsed = parseFloat(rVal);
                if (!isNaN(parsed)) {
                    // If they enter 95, it becomes 0.95. If they enter .95, it remains 0.95.
                    decimalPart = parsed > 1 ? parsed / 100 : parsed;
                }
            }
            return (Math.floor(value) + decimalPart).toFixed(2);
        }
        return value.toFixed(2);
    };

    const calculateNewValue = useCallback((original: number | string, context?: { price?: string | number, compareAtPrice?: string | number, cost?: string | number }) => {
        const numOriginal = parseFloat(original as string) || 0;
        const numEditValue = parseFloat(editValue) || 0;
        let newVal = numOriginal;

        if (editMethod === 'fixed') newVal = numEditValue;
        else if (editMethod === 'percentage_inc') newVal = numOriginal * (1 + numEditValue / 100);
        else if (editMethod === 'percentage_dec') newVal = numOriginal * (1 - numEditValue / 100);
        else if (editMethod === 'amount_inc') newVal = numOriginal + numEditValue;
        else if (editMethod === 'amount_dec') newVal = numOriginal - numEditValue;
        const numPrice = (fieldToEdit === 'price') ? numOriginal : (parseFloat(context?.price as string) || 0);
        const numCompareAt = parseFloat(context?.compareAtPrice as string) || 0;
        const numCost = parseFloat(context?.cost as string) || 0;

        if (editMethod === 'percentage_of_price') {
            newVal = numPrice * (numEditValue / 100);
        }
        else if (editMethod === 'set_to_compare_at') newVal = numCompareAt;
        else if (editMethod === 'percentage_of_compare_at') newVal = numCompareAt * (numEditValue / 100);
        else if (editMethod === 'set_to_cost') newVal = numCost;
        else if (editMethod === 'percentage_of_cost') newVal = numCost * (numEditValue / 100);
        else if (editMethod === 'set_to_price') newVal = numPrice;

        if (['price', 'compare_price', 'cost'].includes(fieldToEdit)) {
            return applyRounding(newVal, rounding, roundingValue);
        }

        return newVal.toString();
    }, [editMethod, editValue, rounding, roundingValue, fieldToEdit]);

    const calculateNewCompareAt = useCallback((compareAt: number | string, context: { price: string | number, cost?: string | number }) => {
        if (compareAtPriceOption === 'none') return "";
        if (compareAtPriceOption === 'null') return "";

        const numCompareAt = parseFloat(compareAt as string) || 0;
        const numPrice = parseFloat(context.price as string) || 0;
        const numCost = parseFloat(context.cost as string) || 0;
        const numEditValue = parseFloat(compareAtEditValue) || 0;

        let newVal = numCompareAt;

        if (compareAtEditMethod === 'fixed') newVal = numEditValue;
        else if (compareAtEditMethod === 'amount_inc') newVal = numCompareAt + numEditValue;
        else if (compareAtEditMethod === 'amount_dec') newVal = numCompareAt - numEditValue;
        else if (compareAtEditMethod === 'percentage_inc') newVal = numCompareAt * (1 + numEditValue / 100);
        else if (compareAtEditMethod === 'percentage_dec') newVal = numCompareAt * (1 - numEditValue / 100);
        else if (compareAtEditMethod === 'set_to_price') newVal = numPrice;
        else if (compareAtEditMethod === 'percentage_of_price') newVal = numPrice * (numEditValue / 100);
        else if (compareAtEditMethod === 'percentage_of_compare_at') newVal = numCompareAt * (numEditValue / 100);
        else if (compareAtEditMethod === 'set_to_cost') newVal = numCost;
        else if (compareAtEditMethod === 'percentage_of_cost') newVal = numCost * (numEditValue / 100);
        else if (compareAtEditMethod === 'set_to_null') return "";

        if (compareAtPriceOption !== 'none' && compareAtPriceOption !== 'null') {
            return applyRounding(newVal, rounding, roundingValue);
        }

        return newVal < 0 ? "0.00" : newVal.toFixed(2);
    }, [compareAtPriceOption, compareAtEditValue, compareAtEditMethod, rounding, roundingValue]);

    const calculateNewPrice = useCallback((currentPrice: number | string, context: { compareAtPrice?: string | number, cost?: string | number }) => {
        if (fieldToEdit !== 'compare_price' || priceOption === 'set') return "";

        const numPrice = parseFloat(currentPrice as string) || 0;
        const numCompareAt = parseFloat(context.compareAtPrice as string) || 0;
        const numCost = parseFloat(context.cost as string) || 0;
        const numEditValue = parseFloat(priceEditValue) || 0;

        let newVal = numPrice;

        if (priceEditMethod === 'fixed') newVal = numEditValue;
        else if (priceEditMethod === 'amount_inc') newVal = numPrice + numEditValue;
        else if (priceEditMethod === 'amount_dec') newVal = numPrice - numEditValue;
        else if (priceEditMethod === 'percentage_inc') newVal = numPrice * (1 + numEditValue / 100);
        else if (priceEditMethod === 'percentage_dec') newVal = numPrice * (1 - numEditValue / 100);
        else if (priceEditMethod === 'set_to_compare_at') newVal = numCompareAt;
        else if (priceEditMethod === 'percentage_of_compare_at') newVal = numCompareAt * (numEditValue / 100);
        else if (priceEditMethod === 'set_to_cost') newVal = numCost;
        else if (priceEditMethod === 'percentage_of_cost') newVal = numCost * (numEditValue / 100);

        if (priceOption === 'set') {
            return applyRounding(newVal, rounding, roundingValue);
        }

        return newVal < 0 ? "0.00" : newVal.toFixed(2);
    }, [fieldToEdit, priceOption, priceEditValue, priceEditMethod, rounding, roundingValue]);

    const applyTextEdit = (originalText: string, method: string, inputs: { value?: string, findText?: string, replaceText?: string, prefixValue?: string, suffixValue?: string }) => {
        const original = originalText || "";
        switch (method) {
            case 'set_vendor':
            case 'set_type':
            case 'fixed':
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
    };

    // Auto-select created definition
    useEffect(() => {
        if (createDefFetcher.state === "idle" && createDefFetcher.data?.ok && createDefFetcher.data?.definition) {
            const def = createDefFetcher.data.definition;
            window.shopify.toast.show("Metafield definition created. Storefront & Admin API access auto-enabled.");
            setMetafieldMode(0); // Switch to existing tab
            // Update target if needed (returned type might strictly match input)
            // Select it
            updateMetafieldState(def);
        } else if (createDefFetcher.data?.ok === false) {
            window.shopify.toast.show(createDefFetcher.data.error, { isError: true });
        }
    }, [createDefFetcher.state, createDefFetcher.data]);


    const getTaskDescription = () => {
        const edits: string[] = [];
        const scheduling: string[] = [];
        const applications: string[] = [];

        const fieldLabel = ({
            price: "Price",
            compare_price: "Compare at price",
            cost: "Cost",
            inventory: "Inventory",
            tags: "Tags",
            status: "Status",
            metafield: "Metafield",
            weight: "Weight",
            vendor: "Vendor",
            product_type: "Product type",
            requires_shipping: "Requires shipping",
            taxable: "Taxable",
            title: "Title",
            body_html: "Body HTML",
            handle: "Handle",
            template_suffix: "Template Suffix",
            published: "Published Status",
            sku: "SKU",
            barcode: "Barcode",
            inventory_policy: "Inventory Policy",
            seo_title: "SEO Title",
            seo_description: "SEO Description",
            google_product_category: "Google Product Category",
            google_custom_label_0: "Google Custom Label 0",
            google_custom_label_1: "Google Custom Label 1",
            google_custom_label_2: "Google Custom Label 2",
            google_custom_label_3: "Google Custom Label 3",
            google_custom_label_4: "Google Custom Label 4",
            google_item_group_id: "Google Item Group ID",
            google_custom_product: "Google Custom Product"
        } as any)[fieldToEdit] || fieldToEdit;

        if (fieldToEdit === 'status') {
            edits.push(`Set status to "${editValue || 'Active'}"`);
        } else if (['requires_shipping', 'taxable', 'published'].includes(fieldToEdit)) {
            let val = editValue === 'true' ? 'True' : 'False';
            if (fieldToEdit === 'published') val = editValue === 'true' ? 'Visible' : 'Hidden';
            else if (fieldToEdit === 'requires_shipping' || fieldToEdit === 'taxable') val = editValue === 'true' ? 'Yes' : 'No';
            edits.push(`Set ${fieldLabel} to "${val}"`);
        } else if (fieldToEdit === 'weight') {
            const method = editMethod === 'fixed' ? 'fixed value' : (editMethod.includes('inc') ? 'increase' : 'decrease');
            edits.push(`${fieldLabel} (${method}): ${editValue}${weightUnit}`);
        } else if (['vendor', 'product_type', 'title', 'body_html', 'handle', 'template_suffix', 'sku', 'barcode', 'seo_title', 'seo_description', 'google_product_category', 'google_custom_label_0', 'google_custom_label_1', 'google_custom_label_2', 'google_custom_label_3', 'google_custom_label_4', 'google_item_group_id', 'google_custom_product'].includes(fieldToEdit)) {
            const method = editMethod === 'replace_text' ? 'replace text' : 'fixed value';
            edits.push(`${fieldLabel} (${method}): "${editValue}"`);
        } else if (fieldToEdit === 'inventory_policy') {
            const val = editValue?.toUpperCase() === 'CONTINUE' ? 'Continue' : 'Deny';
            edits.push(`Set ${fieldLabel} to "${val}"`);
        } else if (fieldToEdit === 'tags') {
            const method = editMethod === 'add_tags' ? 'Add tags' : (editMethod === 'remove_tags' ? 'Remove tags' : 'Replace tags');
            const tags = editMethod === 'add_tags' ? tagsToAdd : (editMethod === 'remove_tags' ? tagsToRemove : editValue);
            edits.push(`${fieldLabel} (${method}): "${Array.isArray(tags) ? tags.join("\", \"") : tags}"`);
        } else if (fieldToEdit === 'metafield') {
            const mName = metafieldMode === 1 ? metafieldSearchText : (selectedDefinition?.name || `${metafieldNamespace}.${metafieldKey}`);
            const mLabel = `Metafield "${mName || 'unknown'}"`;

            const methodLabels: any = {
                clear_value: "clear value",
                fixed: "fixed value",
                append_text: "append text",
                replace_text: "replace text",
                increase_number: "increase number",
                decrease_number: "decrease number",
                toggle_boolean: "toggle boolean",
                increase_percent: "increase by percent",
                decrease_percent: "decrease by percent",
                fixed_true: "set to true",
                fixed_false: "set to false"
            };
            const methodLabel = methodLabels[editMethod] || editMethod;

            if (editMethod === 'clear_value') {
                edits.push(`${mLabel} (${methodLabel})`);
            } else if (editMethod === 'toggle_boolean') {
                edits.push(`${mLabel} (${methodLabel})`);
            } else if (editMethod === 'fixed' || editMethod === 'fixed_true' || editMethod === 'fixed_false') {
                const val = editMethod === 'fixed_true' ? 'true' : (editMethod === 'fixed_false' ? 'false' : editValue);
                edits.push(`${mLabel} (${methodLabel}): "${val}"`);
            } else {
                edits.push(`${mLabel} (${methodLabel}): "${editValue}"`);
            }
        } else {
            let mainDescription = "";
            const methodLabels: any = {
                fixed: "fixed value",
                amount_dec: "decrease by amount",
                amount_inc: "increase by amount",
                percentage_dec: "decrease by percentage",
                percentage_inc: "increase by percentage",
                percentage_of_price: "percentage of price",
                set_to_compare_at: "compare-at price",
                percentage_of_compare_at: "percentage of compare-at price",
                set_to_cost: "cost price",
                percentage_of_cost: "percentage of cost price",
                set_to_price: "product price"
            };
            const methodLabel = methodLabels[editMethod] || editMethod;

            const isPriceField = ['price', 'compare_price', 'cost'].includes(fieldToEdit);
            const isPercentage = editMethod.includes("percentage");
            const valueDisplay = isPercentage ? `${editValue}%` : (isPriceField ? `${currencySymbol}${editValue}` : editValue);

            if (editMethod === 'set_to_compare_at' || editMethod === 'set_to_cost' || editMethod === 'set_to_price') {
                mainDescription = `${fieldLabel} (${methodLabel})`;
            } else {
                mainDescription = `${fieldLabel} (${methodLabel}): ${valueDisplay}`;
            }

            if (isPriceField && rounding !== 'none') {
                let roundingDesc = "";
                if (rounding === 'nearest_01') roundingDesc = 'nearest .01';
                else if (rounding === 'nearest_whole') roundingDesc = 'nearest whole number';
                else if (rounding === 'nearest_99') roundingDesc = 'nearest .99';
                else if (rounding === 'custom_ending') roundingDesc = `ending in .${roundingValue || 'xx'}`;
                mainDescription += `. Round to ${roundingDesc}`;
            }
            edits.push(mainDescription);

            if (fieldToEdit === 'price' && compareAtPriceOption === 'set') {
                const caIsPercentage = compareAtEditMethod.includes("percentage");
                const caValueDisplay = caIsPercentage ? `${compareAtEditValue}%` : `${currencySymbol}${compareAtEditValue}`;
                const caMethodLabels: any = {
                    fixed: "fixed value",
                    amount_dec: "decrease by amount",
                    amount_inc: "increase by amount",
                    percentage_dec: "decrease by percentage",
                    percentage_inc: "increase by percentage",
                    set_to_price: "price",
                    percentage_of_price: "percentage of price",
                    percentage_of_compare_at: "percentage of compare-at price",
                    set_to_cost: "cost price",
                    percentage_of_cost: "percentage of cost price",
                    set_to_null: "null (empty)"
                };
                const caMethodLabel = caMethodLabels[compareAtEditMethod] || compareAtEditMethod;

                let caDescription = "";
                if (compareAtEditMethod === 'fixed') {
                    caDescription = `Set compare-at price to ${caValueDisplay}`;
                } else {
                    const action = compareAtEditMethod.includes("inc") ? "increase" : (compareAtEditMethod.includes("dec") ? "decrease" : "update");
                    caDescription = `Compare-at price ${action} by ${caValueDisplay}`;
                }
                edits.push(caDescription);
            } else if (fieldToEdit === 'price' && compareAtPriceOption === 'null') {
                edits.push(`Set compare-at price to empty`);
            }

            if (fieldToEdit === 'compare_price' && priceOption === 'set') {
                const pIsPercentage = priceEditMethod.includes("percentage");
                const pValueDisplay = pIsPercentage ? `${priceEditValue}%` : `${currencySymbol}${priceEditValue}`;
                const pMethodLabels: any = {
                    fixed: "fixed value",
                    amount_dec: "decrease by amount",
                    amount_inc: "increase by amount",
                    percentage_dec: "decrease by percentage",
                    percentage_inc: "increase by percentage",
                    set_to_compare_at: "compare-at price",
                    percentage_of_compare_at: "percentage of compare-at price",
                    set_to_cost: "cost price",
                    percentage_of_cost: "percentage of cost price",
                    set_to_price: "product price"
                };
                const pMethodLabel = pMethodLabels[priceEditMethod] || priceEditMethod;

                let pDescription = "";
                if (['set_to_compare_at', 'set_to_cost', 'set_to_price'].includes(priceEditMethod)) {
                    pDescription = `Set the price (${pMethodLabel})`;
                } else {
                    pDescription = `Set the price (${pMethodLabel}): ${pValueDisplay}`;
                }
                edits.push(pDescription);
            } else if (fieldToEdit === 'compare_price' && priceOption === 'none') {
                edits.push("Don't change price");
            }
        }

        // Market logic
        if (['price', 'compare_price'].includes(fieldToEdit) && applyToMarkets && selectedMarkets.length > 0) {
            const marketNames = markets
                .filter((m: any) => selectedMarkets.includes(m.handle))
                .map((m: any) => m.name)
                .join(", ");
            applications.push(`Markets: ${marketNames}`);
            if (!applyToBasePrice) {
                applications.push("Base price will NOT be updated");
            }
        }

        // Exclude specific products
        if (excludeSpecificProducts && excludedProductsList.length > 0) {
            applications.push(`Exclude ${excludedProductsList.length} specific products`);
        }

        // Start Schedule
        if (startTime === 'now') {
            scheduling.push("Start now");
        } else if (startTime === 'schedule') {
            if (scheduledStartDate && scheduledStartTime) {
                const start = new Date(`${formatToYYYYMMDD(scheduledStartDate.start)}T${scheduledStartTime}`).toLocaleString();
                scheduling.push(`Start at: ${start}`);
            } else {
                scheduling.push(`Start time (Date/Time pending)`);
            }
        } else if (startTime === 'manual') {
            scheduling.push("Start manually");
        }

        if (fieldToEdit !== 'tags') {
            if (addTags && tagsToAdd.length > 0) {
                edits.push(`Also add tags: "${Array.isArray(tagsToAdd) ? tagsToAdd.join("\", \"") : tagsToAdd}"`);
            }
            if (removeTags && tagsToRemove.length > 0) {
                edits.push(`Also remove tags: "${Array.isArray(tagsToRemove) ? tagsToRemove.join("\", \"") : tagsToRemove}"`);
            }
        }

        if (scheduleRevert) {
            if (scheduledRevertDate && scheduledRevertTime) {
                const revert = new Date(`${formatToYYYYMMDD(scheduledRevertDate.start)}T${scheduledRevertTime}`).toLocaleString();
                scheduling.push(`Revert at: ${revert}`);
            } else {
                scheduling.push(`Revert time (Date/Time pending)`);
            }
        }

        return { edits, scheduling, applications };
    };

    const getSelectionDescription = () => {
        const previewCount = fetcher.data?.totalCount;

        if (applyToProducts === 'all') return `Applies to all products (${productsCount} products)`;

        if (applyToProducts === 'collections') {
            const count = previewCount !== undefined ? previewCount : selectedCollections.length;
            return `Applies to ${count} products in selected collections`;
        }

        if (applyToProducts === 'specific') return `Applies to ${selectedProducts.length} products selected`;

        if (applyToProducts === 'conditions') {
            const count = previewCount !== undefined ? previewCount : "?";
            const logic = productMatchLogic === 'all' ? 'all' : 'any';

            // Add metafield names if present
            const metafieldInfo = productConditions
                .filter(c => c.property === 'metafield' && c.metafieldKey)
                .map(c => `[${c.metafieldKey}]`)
                .join(", ");

            let desc = `Applies to ${count} products matching ${logic} of ${productConditions.length} conditions`;
            if (metafieldInfo) desc += ` (Metafields: ${metafieldInfo})`;
            return desc;
        }

        return "Applies to selection";
    };

    const [popoverActive, setPopoverActive] = useState(false);
    const [revertPopoverActive, setRevertPopoverActive] = useState(false);
    const [startTimePopoverActive, setStartTimePopoverActive] = useState(false);
    const [revertTimePopoverActive, setRevertTimePopoverActive] = useState(false);

    const togglePopoverActive = useCallback(() => setPopoverActive((active) => !active), []);
    const toggleRevertPopoverActive = useCallback(() => setRevertPopoverActive((active) => !active), []);
    const toggleStartTimePopoverActive = useCallback(() => setStartTimePopoverActive((active) => !active), []);
    const toggleRevertTimePopoverActive = useCallback(() => setRevertTimePopoverActive((active) => !active), []);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
    };

    const formatToYYYYMMDD = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formatTimezone = (iana: string) => {
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: iana,
                timeZoneName: 'shortOffset'
            });
            const parts = formatter.formatToParts(now);
            const offset = parts.find(p => p.type === 'timeZoneName')?.value || "";

            // Map common IANA zones to descriptive names to match the reference
            const names: Record<string, string> = {
                'Asia/Kolkata': 'Chennai, Kolkata, Mumbai, New Delhi',
                'Asia/Calcutta': 'Chennai, Kolkata, Mumbai, New Delhi',
                'America/New_York': 'Eastern Time (US & Canada)',
                'America/Los_Angeles': 'Pacific Time (US & Canada)',
                'Europe/London': 'London, Dublin, Edinburgh',
            };

            const cityNames = names[iana] || iana.split('/').pop()?.replace(/_/g, " ") || iana;
            return `(${offset}) ${cityNames}`;
        } catch (e) {
            return iana;
        }
    };

    const timeOptions = useCallback(() => {
        const options = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 5) {
                const h = hour % 12 || 12;
                const m = minute.toString().padStart(2, '0');
                const period = hour < 12 ? 'AM' : 'PM';
                const label = `${h}:${m} ${period}`;
                const value = `${hour.toString().padStart(2, '0')}:${m}`;
                options.push({ label, value });
            }
        }
        return options;
    }, []);

    const [timeInputValue, setTimeInputValue] = useState(formatTo12Hour(getInitialTime()));
    const [revertTimeInputValue, setRevertTimeInputValue] = useState(formatTo12Hour(getInitialTime()));

    const timeAutocompleteOptions = timeOptions().filter(option =>
        option.label.toLowerCase().includes(timeInputValue.toLowerCase())
    );

    const revertTimeAutocompleteOptions = timeOptions().filter(option =>
        option.label.toLowerCase().includes(revertTimeInputValue.toLowerCase())
    );

    useEffect(() => {
        if (scheduledStartTime) {
            setTimeInputValue(formatTo12Hour(scheduledStartTime));
        }
    }, [scheduledStartTime, formatTo12Hour]);

    useEffect(() => {
        if (scheduledRevertTime) {
            setRevertTimeInputValue(formatTo12Hour(scheduledRevertTime));
        }
    }, [scheduledRevertTime, formatTo12Hour]);

    const isStartTimeValid = () => {
        if (startTime !== 'schedule') return true;
        if (!scheduledStartDate.start || !scheduledStartTime) return false;

        const [hours, minutes] = scheduledStartTime.split(':').map(Number);
        const scheduledDateTime = new Date(scheduledStartDate.start);
        scheduledDateTime.setHours(hours, minutes, 0, 0);

        const now = new Date();
        now.setSeconds(0, 0); // Grace period: ignore seconds
        return scheduledDateTime >= now;
    };

    const isRevertTimeValid = () => {
        if (!scheduleRevert) return true;

        // Start DateTime
        let startDateTime: Date;
        if (startTime === 'now') {
            startDateTime = new Date();
        } else {
            if (!scheduledStartDate || !scheduledStartTime) return true;
            const [hours, minutes] = scheduledStartTime.split(':').map(Number);
            startDateTime = new Date(scheduledStartDate.start);
            startDateTime.setHours(hours, minutes, 0, 0);
        }

        // Revert DateTime
        if (!scheduledRevertDate || !scheduledRevertTime) return true;
        const [revertHours, revertMinutes] = scheduledRevertTime.split(':').map(Number);
        const revertDateTime = new Date(scheduledRevertDate.start);
        revertDateTime.setHours(revertHours, revertMinutes, 0, 0);

        // Diff in minutes
        const diffInMinutes = (revertDateTime.getTime() - startDateTime.getTime()) / (1000 * 60);
        return diffInMinutes >= 5;
    };

    const addProductCondition = () => setProductConditions([...productConditions, { property: "title", operator: "contains", value: "", metafieldKey: "" }]);
    const removeProductCondition = (index: number) => setProductConditions(productConditions.filter((_, i) => i !== index));
    const updateProductCondition = (index: number, field: string | Record<string, any>, value?: string) => {
        // DEBUG: Log updates to value field
        if (field === "value" || (typeof field === 'object' && 'value' in field)) {
            console.log("=== UPDATE PRODUCT CONDITION VALUE ===", { index, field, value });
        }

        const newConditions = [...productConditions];
        if (typeof field === 'object') {
            newConditions[index] = { ...newConditions[index], ...field };
        } else {
            newConditions[index] = { ...newConditions[index], [field]: value };
        }

        // DEBUG: Log the updated condition
        if (field === "value" || (typeof field === 'object' && 'value' in field)) {
            console.log("=== UPDATED CONDITION ===", JSON.stringify(newConditions[index], null, 2));
        }

        setProductConditions(newConditions);
    };

    const handleProductPropertyChange = (index: number, newProperty: string) => {
        const newConditions = [...productConditions];
        const existingCondition = newConditions[index];
        let newOperator = "contains";
        let newValue = "";

        if (newProperty === 'status') {
            newOperator = "equals";
            newValue = "active";
        } else if (newProperty === 'collection') {
            newOperator = "equals";
            newValue = collections[0]?.id.split("/").pop() || "";
        } else if (newProperty === 'type') {
            newOperator = "equals";
            newValue = productTypes[0] || "";
        } else if (newProperty === 'vendor') {
            newOperator = "equals";
            newValue = productVendors[0] || "";
        } else if (newProperty === 'created_at' || newProperty === 'updated_at') {
            newOperator = "greater_than";
        } else if (['item_price', 'inventory_total'].includes(newProperty)) {
            newOperator = "greater_than";
        }

        // Preserve metafield-specific fields if switching to/from metafield
        if (newProperty === 'metafield') {
            // Switching TO metafield: preserve any existing metafield data
            newConditions[index] = {
                ...existingCondition,
                property: newProperty,
                operator: newOperator,
                value: newValue
                // Keep metafieldKey, metafieldNamespace, originalKey, etc. if they exist
            };
        } else {
            // Switching AWAY from metafield: clear metafield-specific fields
            newConditions[index] = {
                property: newProperty,
                operator: newOperator,
                value: newValue
            };
        }
        setProductConditions(newConditions);
    };

    const addVariantCondition = () => setVariantConditions([...variantConditions, { property: "title", operator: "contains", value: "", metafieldKey: "" }]);
    const removeVariantCondition = (index: number) => setVariantConditions(variantConditions.filter((_, i) => i !== index));
    const updateVariantCondition = (index: number, field: string, value: string) => {
        const newConditions = [...variantConditions];
        newConditions[index] = { ...newConditions[index], [field]: value };
        setVariantConditions(newConditions);
    };
    const handleVariantPropertyChange = (index: number, newProperty: string) => {
        const newConditions = [...variantConditions];
        let newOperator = "contains";
        let newValue = "";

        if (['price', 'compare_at', 'inventory'].includes(newProperty)) {
            newOperator = "greater_than";
        } else if (['sku', 'title', 'option_name', 'option_value'].includes(newProperty)) {
            newOperator = "contains";
        }

        newConditions[index] = {
            ...newConditions[index],
            property: newProperty,
            operator: newOperator,
            value: newValue
        };
        setVariantConditions(newConditions);
    };

    const selectCollections = async () => {
        const selection = await window.shopify.resourcePicker({
            type: "collection",
            multiple: true,
            selectionIds: selectedCollections.map(c => ({ id: c.id }))
        });

        if (selection) {
            setSelectedCollections(selection);
        }
    };

    const selectProducts = async () => {
        const selection = await window.shopify.resourcePicker({
            type: "product",
            multiple: true,
            selectionIds: selectedProducts.map(p => ({ id: p.id }))
        });

        if (selection) {
            setSelectedProducts(selection);
        }
    };

    const selectExcludedProducts = async () => {
        const selection = await window.shopify.resourcePicker({
            type: "product",
            multiple: true,
            selectionIds: excludedProductsList.map(p => ({ id: p.id }))
        });

        if (selection) {
            setExcludedProductsList(selection);
        }
    };

    // Handle demo creation success
    const [demoProduct, setDemoProduct] = useState<{ id: string; handle: string } | null>(null);

    useEffect(() => {
        if (demoFetcher.state === "idle" && demoFetcher.data?.ok && demoFetcher.data?.product) {
            const product = demoFetcher.data.product;
            setDemoProduct({ id: product.id, handle: product.handle });
            window.shopify.toast.show("Demo product created");

            // Auto-select the demo product for preview
            setApplyToProducts("specific");
            setSelectedProducts([{ id: product.id, title: product.title }]);

            // Reset market to base to ensure we see the prices
            setApplyToMarkets(false);
            setApplyToBasePrice(true);
            setSelectedPreviewMarket("base");

            // Force refresh is handled by the useEffect dependent on selectProducts/applyToProducts
        } else if (demoFetcher.data?.ok === false) {
            const errorMessage = demoFetcher.data.error || (demoFetcher.data.errors ? demoFetcher.data.errors[0].message : "Failed to create demo product");
            window.shopify.toast.show(errorMessage, { isError: true });
        }
    }, [demoFetcher.state, demoFetcher.data]);

    // Stabilize fetcher state with a ref to avoid function recreation loop
    const fetcherStateRef = useRef(fetcher.state);
    useEffect(() => {
        fetcherStateRef.current = fetcher.state;
    }, [fetcher.state]);

    // Real-time Preview Fetcher
    const refreshPreview = useCallback((cursor?: string, direction?: "next" | "prev") => {
        // Explicitly allow refreshes even if not idle, as Remix handles cancellation
        // and we want user-initiated changes (like market selection) to be responsive.

        console.log("Refreshing preview for fieldToEdit:", fieldToEdit);
        const formData = new FormData();
        formData.append("intent", "refresh-preview");
        formData.append("fieldToEdit", fieldToEdit);
        formData.append("applyToProducts", applyToProducts);
        formData.append("selectedProducts", JSON.stringify(selectedProducts));
        formData.append("selectedCollections", JSON.stringify(selectedCollections));

        // DEBUG: Log what we're sending
        if (productConditions.length > 0) {
            console.log("=== SENDING PRODUCT CONDITIONS ===", JSON.stringify(productConditions, null, 2));
        }

        formData.append("productConditions", JSON.stringify(productConditions));
        formData.append("productMatchLogic", productMatchLogic);
        formData.append("applyToVariants", applyToVariants);
        formData.append("variantConditions", JSON.stringify(variantConditions));
        formData.append("variantMatchLogic", variantMatchLogic);
        formData.append("excludeSpecificProducts", excludeSpecificProducts.toString());
        formData.append("excludedProductsList", JSON.stringify(excludedProductsList));

        if (fieldToEdit === 'metafield') {
            formData.append("metafieldNamespace", metafieldNamespace);
            formData.append("metafieldKey", metafieldKey);
            formData.append("metafieldTargetType", metafieldTargetType);
        }

        if (fieldToEdit === 'inventory') {
            formData.append("locationId", locationId);
        }

        if (cursor && direction) {
            formData.append("cursor", cursor);
            formData.append("direction", direction);
        }

        if (selectedPreviewMarket && selectedPreviewMarket !== 'base') {
            const marketObj = markets.find((m: any) => m.handle === selectedPreviewMarket);
            const countryCode = marketObj?.regions?.nodes?.[0]?.code;
            if (countryCode) {
                formData.append("countryCode", countryCode);
            }
        }

        fetcher.submit(formData, { method: "POST", action: "/app/preview-data" });
    }, [applyToProducts, selectedProducts, selectedCollections, productConditions, productMatchLogic, applyToVariants, variantConditions, variantMatchLogic, fetcher.submit, fieldToEdit, locationId, metafieldNamespace, metafieldKey, metafieldTargetType, excludeSpecificProducts, excludedProductsList, selectedPreviewMarket, markets]);

    const showSidebarTags = (addTags && (tagsToAdd || []).length > 0) || (removeTags && (tagsToRemove || []).length > 0);

    const rows = useMemo(() => {
        const products = fetcher.data?.products || [];
        const market = selectedPreviewMarket;
        if (!products.length || market === 'empty') return [];

        // Safety net: deduplicate input products by ID
        const uniqueProductsMap = new Map();
        products.forEach((p: any) => {
            if (!uniqueProductsMap.has(p.id)) {
                uniqueProductsMap.set(p.id, p);
            }
        });
        const uniqueProducts = Array.from(uniqueProductsMap.values());

        return uniqueProducts.flatMap((p: any) => {
            // Calculation logic unified for single and multiple variants
            const getRowData = (variant: any) => {
                const v = variant || {};
                let originalV = v.price || "0.00";
                let originalCompareV = v.compareAtPrice || "0.00";
                let updateV = fieldToEdit === 'compare_price'
                    ? (priceOption === 'set' ? calculateNewPrice(v.price || "0", { compareAtPrice: v.compareAtPrice, cost: v.cost }) : originalV)
                    : calculateNewValue(v.price || "0", { compareAtPrice: v.compareAtPrice, cost: v.cost });
                let updateCompareV = fieldToEdit === 'compare_price'
                    ? calculateNewValue(v.compareAtPrice || "0", { price: v.price, compareAtPrice: v.compareAtPrice, cost: v.cost })
                    : calculateNewCompareAt(v.compareAtPrice, { price: v.price, cost: v.cost });

                let originalVal = "";
                let updateVal = "";

                if (fieldToEdit === 'inventory') {
                    originalVal = v.inventory?.toString() || "0";
                    updateVal = editMethod === 'fixed' ? (parseInt(editValue) || 0).toString() : calculateNewValue(originalVal);
                } else if (fieldToEdit === 'cost') {
                    originalVal = v.cost || "0.00";
                    updateVal = calculateNewValue(originalVal, { price: v.price, compareAtPrice: v.compareAtPrice, cost: v.cost });
                    originalV = v.price || "0.00";
                    originalCompareV = v.compareAtPrice || "0.00";
                } else if (fieldToEdit === 'status') {
                    originalVal = p.status;
                    updateVal = editMethod === 'fixed' ? (editValue || "ACTIVE") : originalVal;
                } else if (fieldToEdit === 'weight') {
                    originalVal = `${v.weight} ${v.weightUnit || ""}`;
                    let newWeight = parseFloat(v.weight || "0");
                    const editValNum = parseFloat(editValue || "0");
                    if (editMethod === 'fixed') newWeight = editValNum;
                    else if (editMethod === 'amount_inc') newWeight += editValNum;
                    else if (editMethod === 'amount_dec') newWeight -= editValNum;

                    const targetUnit = weightUnit || v.weightUnit || "kg";
                    updateVal = `${newWeight.toFixed(3)} ${targetUnit}`;
                } else if (fieldToEdit === 'vendor') {
                    originalVal = p.vendor;
                    updateVal = applyTextEdit(originalVal, editMethod, {
                        value: editValue,
                        findText: findText,
                        replaceText: replaceText,
                        prefixValue: editValue,
                        suffixValue: editValue
                    });
                } else if (fieldToEdit === 'product_type') {
                    originalVal = p.productType;
                    updateVal = applyTextEdit(originalVal, editMethod, {
                        value: editValue,
                        findText: findText,
                        replaceText: replaceText,
                        prefixValue: editValue,
                        suffixValue: editValue
                    });
                } else if (fieldToEdit === 'requires_shipping') {
                    originalVal = v.requiresShipping ? "True" : "False";
                    updateVal = String(editValue).toLowerCase() === 'true' ? "True" : "False";
                } else if (fieldToEdit === 'taxable') {
                    originalVal = v.taxable ? "True" : "False";
                    updateVal = String(editValue).toLowerCase() === 'true' ? "True" : "False";
                } else if (fieldToEdit === 'metafield') {
                    const target = metafieldTargetType === 'product' ? p : v;
                    // Find the metafield in the edges array
                    const metafieldEdge = target.metafields?.edges?.find((e: any) =>
                        e.node.namespace === metafieldNamespace && e.node.key === metafieldKey
                    );
                    originalVal = metafieldEdge?.node?.value || "";
                    updateVal = calculateUpdatedMetafieldValue({
                        originalValue: originalVal,
                        type: metafieldType,
                        editMethod,
                        inputValue: editValue
                    });
                } else if (fieldToEdit === 'price') {
                    originalVal = v.price;
                    updateVal = updateV;
                } else if (fieldToEdit === 'compare_price') {
                    originalVal = v.compareAtPrice || "";
                    updateVal = calculateNewValue(originalVal || "0", { price: v.price, compareAtPrice: v.compareAtPrice, cost: v.cost });
                } else if (['title', 'body_html', 'handle', 'template_suffix', 'sku', 'barcode', 'seo_title', 'seo_description', 'google_product_category', 'google_age_group', 'google_gender', 'google_color', 'google_size', 'google_material', 'google_pattern', 'google_condition', 'google_mpn', 'google_brand', 'google_item_group_id', 'google_custom_product', 'google_custom_label_0', 'google_custom_label_1', 'google_custom_label_2', 'google_custom_label_3', 'google_custom_label_4', 'weight_unit', 'hs_code', 'country_of_origin'].includes(fieldToEdit)) {
                    originalVal = p[fieldToEdit] || v[fieldToEdit] || "";
                    updateVal = applyTextEdit(originalVal, editMethod, {
                        value: editValue,
                        findText: findText,
                        replaceText: replaceText,
                        prefixValue: editValue,
                        suffixValue: editValue
                    });
                } else if (fieldToEdit === 'option1_name' || fieldToEdit === 'option2_name' || fieldToEdit === 'option3_name') {
                    const idx = fieldToEdit === 'option1_name' ? 0 : (fieldToEdit === 'option2_name' ? 1 : 2);
                    originalVal = p.options?.[idx]?.name || `Option ${idx + 1}`;
                    updateVal = applyTextEdit(originalVal, editMethod, {
                        value: editValue,
                        findText: findText,
                        replaceText: replaceText,
                        prefixValue: editValue,
                        suffixValue: editValue
                    });
                } else if (fieldToEdit === 'variant_management') {
                    originalVal = "Existing variants";
                    updateVal = editMethod === 'add_variant' ? "NEW VARIANT" : (editMethod === 'sort_variants' ? "REORDER" : "UPDATE");
                } else if (fieldToEdit === 'add_option') {
                    originalVal = "N/A";
                    updateVal = "NEW OPTION";
                }

                // Handle tags (both for main field and sidebar)
                let tagsOriginal = "";
                let tagsUpdated = "";
                
                // Fetch product-level tags as they are global for all variants
                const currentTags = Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? (p.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean) : []);
                tagsOriginal = currentTags.join(", ");
                let newTagsList = [...currentTags];

                if (fieldToEdit === 'tags') {
                    const tagsToProcess = (editValue || "").split(",").filter(Boolean).map((t: string) => t.trim());
                    if (editMethod === 'add_tags') {
                        newTagsList = Array.from(new Set([...newTagsList, ...tagsToProcess]));
                    } else if (editMethod === 'remove_tags') {
                        newTagsList = newTagsList.filter(t => !tagsToProcess.includes(t));
                    } else if (editMethod === 'replace_tags') {
                        newTagsList = tagsToProcess;
                    }
                    originalVal = tagsOriginal;
                    updateVal = newTagsList.join(", ");
                }

                if (showSidebarTags) {
                    if (addTags && (tagsToAdd || []).length > 0) {
                        newTagsList = Array.from(new Set([...newTagsList, ...(tagsToAdd || [])]));
                    }
                    if (removeTags && (tagsToRemove || []).length > 0) {
                        const toRemove = tagsToRemove || [];
                        newTagsList = newTagsList.filter(t => !toRemove.includes(t));
                    }
                }
                
                tagsUpdated = newTagsList.join(", ");

                return {
                    originalPrice: v.price,
                    updatePrice: updateV,
                    originalComparePrice: v.compareAtPrice || "",
                    updateComparePrice: updateCompareV,
                    originalCost: v.cost || "0.00",
                    originalVal,
                    updateVal,
                    tagsOriginal,
                    tagsUpdated
                };
            };

            if (!p.variants || p.variants.length <= 1 || fieldToEdit === 'tags') {
                const v = p.variants?.[0] || {};
                const data = getRowData(v);
                return [{
                    id: v.id || p.id,
                    image: p.image,
                    product: p.title,
                    ...data,
                    isParent: false,
                    isVariant: false
                }];
            }

            const parentRecordData = getRowData(p.variants[0]);
            const parentRow = {
                id: p.id,
                image: p.image,
                product: p.title,
                isParent: true,
                originalPrice: "",
                updatePrice: "",
                originalComparePrice: "",
                updateComparePrice: "",
                originalVal: (['tags', 'status', 'vendor', 'product_type', 'requires_shipping', 'taxable', 'google_item_group_id', 'google_custom_product'].includes(fieldToEdit) || (fieldToEdit === 'metafield' && metafieldTargetType === 'product')) ? parentRecordData.originalVal : "",
                updateVal: (['tags', 'status', 'vendor', 'product_type', 'requires_shipping', 'taxable', 'google_item_group_id', 'google_custom_product'].includes(fieldToEdit) || (fieldToEdit === 'metafield' && metafieldTargetType === 'product')) ? parentRecordData.updateVal : ""
            };

            const variantRows = p.variants.map((v: any) => {
                const data = getRowData(v);
                return {
                    id: v.id,
                    image: null,
                    product: v.title,
                    ...data,
                    // Use the tags data from the current variant's record
                    tagsOriginal: data.tagsOriginal,
                    tagsUpdated: data.tagsUpdated,
                    isVariant: true
                };
            });

            return [parentRow, ...variantRows];
        });
    }, [fetcher.data?.products, selectedPreviewMarket, fieldToEdit, priceOption, editMethod, editValue, rounding, roundingValue, metafieldType, metafieldTargetType, metafieldNamespace, metafieldKey, weightUnit, findText, replaceText, calculateNewValue, calculateNewCompareAt, calculateNewPrice, calculateUpdatedMetafieldValue, showSidebarTags, addTags, tagsToAdd, removeTags, tagsToRemove]);

    // Refresh when critical selection changes
    useEffect(() => {
        const hasSelection = applyToProducts === 'all' || applyToProducts === 'conditions' || selectedProducts.length > 0 || selectedCollections.length > 0;

        if (hasSelection) {
            const timer = setTimeout(() => {
                refreshPreview();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [
        refreshPreview,
        fieldToEdit,
        applyToProducts,
        applyToVariants,
        selectedPreviewMarket,
        // Stringify complex dependencies to ensure the effect only runs when content changes
        JSON.stringify(variantConditions),
        variantMatchLogic,
        metafieldNamespace,
        metafieldKey,
        metafieldTargetType,
        JSON.stringify(productConditions),
        productMatchLogic,
        locationId,
        JSON.stringify(selectedProducts),
        JSON.stringify(selectedCollections)
    ]);

    useEffect(() => {
        if (searchParams.get("type")) {
            setFieldToEdit(searchParams.get("type") || "price");
        }
    }, [searchParams]);

    // Debug fetcher data - REMOVED

    // Ensure selectedPreviewMarket is valid when "Base price" option is hidden or market is removed
    useEffect(() => {
        if (applyToMarkets && !applyToBasePrice) {
            if (selectedPreviewMarket === "base" || (selectedPreviewMarket !== "base" && !selectedMarkets.includes(selectedPreviewMarket))) {
                if (selectedMarkets.length > 0) {
                    setSelectedPreviewMarket(selectedMarkets[0]);
                }
            }
        }
    }, [applyToMarkets, applyToBasePrice, selectedMarkets, selectedPreviewMarket]);

    useEffect(() => {
        if (actionData?.error) {
            window.shopify.toast.show(actionData.error, { isError: true });
        }
    }, [actionData]);

    const handleReview = () => {
        // Validation
        if (applyToProducts === 'specific' && selectedProducts.length === 0) {
            window.shopify.toast.show("Please select at least one product", { isError: true });
            return;
        }
        if (applyToProducts === 'collections' && selectedCollections.length === 0) {
            window.shopify.toast.show("Please select at least one collection", { isError: true });
            return;
        }
        if (applyToProducts === 'conditions' && productConditions.length === 0) {
            window.shopify.toast.show("Please add at least one condition", { isError: true });
            return;
        }

        setIsModalOpen(true);
    };

    function handleCreateTask() {
        // Validation
        if (applyToProducts === 'specific' && selectedProducts.length === 0) {
            window.shopify.toast.show("Please select at least one product", { isError: true });
            return;
        }
        if (applyToProducts === 'collections' && selectedCollections.length === 0) {
            window.shopify.toast.show("Please select at least one collection", { isError: true });
            return;
        }
        if (applyToProducts === 'conditions' && productConditions.length === 0) {
            window.shopify.toast.show("Please add at least one condition", { isError: true });
            return;
        }

        const configuration = {
            fieldToEdit,
            editMethod,
            editValue,
            locationId: fieldToEdit === 'inventory' ? locationId : undefined,
            rounding,
            compareAtPriceOption,
            compareAtEditMethod: compareAtPriceOption === 'set' ? compareAtEditMethod : undefined,
            compareAtEditValue: fieldToEdit === 'price' ? compareAtEditValue : undefined,
            priceOption: fieldToEdit === 'compare_price' ? priceOption : undefined,
            priceEditMethod: fieldToEdit === 'compare_price' ? priceEditMethod : undefined,
            priceEditValue: fieldToEdit === 'compare_price' ? priceEditValue : undefined,
            applyToMarkets,
            selectedMarkets,
            applyToBasePrice,
            applyToProducts,
            // Only include relevant selection data
            selectedCollections: applyToProducts === 'collections' ? selectedCollections : [],
            selectedProducts: applyToProducts === 'specific' ? selectedProducts : [],
            productConditions: applyToProducts === 'conditions' ? productConditions : [],
            productMatchLogic,
            excludeSpecificProducts,
            excludedProductsList: excludeSpecificProducts ? excludedProductsList : [],
            applyToVariants,
            variantConditions,
            variantMatchLogic,
            addTags,
            tagsToAdd: Array.isArray(tagsToAdd) ? tagsToAdd.join(",") : tagsToAdd,
            roundingValue: rounding === 'custom_ending' ? roundingValue : undefined,
            removeTags,
            tagsToRemove: Array.isArray(tagsToRemove) ? tagsToRemove.join(",") : tagsToRemove,
            metafieldNamespace: fieldToEdit === 'metafield' ? metafieldNamespace : undefined,
            metafieldKey: fieldToEdit === 'metafield' ? metafieldKey : undefined,
            metafieldType: fieldToEdit === 'metafield' ? metafieldType : undefined,
            metafieldTargetType: fieldToEdit === 'metafield' ? metafieldTargetType : undefined,
            weightUnit: fieldToEdit === 'weight' ? weightUnit : undefined,
            findText: (['vendor', 'product_type', 'title', 'body_html', 'handle', 'template_suffix', 'sku', 'barcode', 'seo_title', 'seo_description', 'google_product_category', 'google_custom_label_0', 'google_custom_label_1', 'google_custom_label_2', 'google_custom_label_3', 'google_custom_label_4', 'google_item_group_id', 'google_custom_product', 'metafield'].includes(fieldToEdit)) ? findText : undefined,
            replaceText: (['vendor', 'product_type', 'title', 'body_html', 'handle', 'template_suffix', 'sku', 'barcode', 'seo_title', 'seo_description', 'google_product_category', 'google_custom_label_0', 'google_custom_label_1', 'google_custom_label_2', 'google_custom_label_3', 'google_custom_label_4', 'google_item_group_id', 'google_custom_product', 'metafield'].includes(fieldToEdit)) ? replaceText : undefined,
        };

        const formData = new FormData();
        formData.append("intent", "create-task");
        formData.append("taskName", taskName);
        formData.append("configuration", JSON.stringify(configuration));
        formData.append("startTime", startTime);
        formData.append("scheduledStartDate", formatToYYYYMMDD(scheduledStartDate.start));
        formData.append("scheduledStartTime", scheduledStartTime);
        formData.append("scheduleRevert", scheduleRevert.toString());
        formData.append("scheduledRevertDate", formatToYYYYMMDD(scheduledRevertDate.start));
        formData.append("scheduledRevertTime", scheduledRevertTime);
        formData.append("ianaTimezone", shop?.ianaTimezone || "UTC");
        formData.append("note", note);
        console.log("DEBUG FRONTEND: Submitting productsCount:", productsCount);
        console.log("DEBUG FRONTEND productsCount:", productsCount); formData.append("productsCount", productsCount.toString());
        
        // Save first 100 rows as initial previewJson
        const previewSample = rows.filter((r: any) => !r.isVariant).slice(0, 100);
        formData.append("previewJson", JSON.stringify(previewSample));

        if (editJob?.job_id) {
            formData.append("editJobId", editJob.job_id.toString());
        }

        submit(formData, { method: "post" });
        setIsModalOpen(false);
    }


    return (
        <Page
            fullWidth
        >
            <BlockStack gap="800">
                {/* Custom Header Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-10%', right: '-5%', width: '200px', height: '200px' }} />
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <BlockStack gap="200">
                            <Text as="h1" variant="heading2xl" fontWeight="bold">
                                {editJob ? "Edit Task" : "Create Task"}
                            </Text>
                            <Text as="p" variant="bodyLg">
                                <span style={{ opacity: 0.9 }}>
                                    {editJob ? "Modify the rules for your scheduled bulk edit operation." : "Define the rules for your new bulk edit operation."}
                                </span>
                            </Text>
                        </BlockStack>
                        <InlineStack gap="300">
                            <div
                                className="premium-button-secondary"
                                onClick={() => navigate("/app/tasks")}
                                style={{ cursor: 'pointer' }}
                            >
                                <Text as="span" fontWeight="medium">Cancel</Text>
                            </div>
                            <Button
                                onClick={handleReview}
                                variant="primary"
                            >
                                Review & Save
                            </Button>
                        </InlineStack>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                    <div style={{
                        flex: isPreviewCollapsed ? '1' : '0 0 33.333%',
                        minWidth: 0,
                        transition: 'all 250ms ease-in-out'
                    }}>
                        <BlockStack gap="400">
                            <Card>
                                <TextField
                                    label="Task name"
                                    value={taskName}
                                    onChange={setTaskName}
                                    autoComplete="off"
                                    maxLength={100}
                                    showCharacterCount
                                    autoFocus
                                />
                                <Divider />
                                <TextField
                                    label="Note"
                                    value={note}
                                    onChange={setNote}
                                    autoComplete="off"
                                    maxLength={500}
                                    placeholder="Add notes for this task..."
                                    multiline={2}
                                />
                            </Card>

                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Field to edit</Text>
                                    <Popover
                                        active={fieldSelectorActive}
                                        activator={
                                            <Button onClick={toggleFieldSelector} disclosure fullWidth textAlign="left">
                                                {getFieldLabel(fieldToEdit)}
                                            </Button>
                                        }
                                        onClose={toggleFieldSelector}
                                    >
                                        <ActionList
                                            sections={groupedFieldOptions.map((group: any) => ({
                                                title: group.title,
                                                items: group.options.map((opt: any) => ({
                                                    content: opt.label,
                                                    icon: isFieldLocked(opt.value) ? LockIcon : undefined,
                                                    suffix: opt.isPro ? <Badge tone="attention" size="small">PRO</Badge> : undefined,
                                                    onAction: () => handleFieldChange(opt.value),
                                                    active: fieldToEdit === opt.value
                                                }))
                                            }))}
                                        />
                                    </Popover>

                                    <Modal
                                        open={upgradeModalOpen}
                                        onClose={() => setUpgradeModalOpen(false)}
                                        title="Upgrade to Pro"
                                        primaryAction={{
                                            content: "View Plans",
                                            onAction: () => navigate("/app/plans")
                                        }}
                                        secondaryActions={[{
                                            content: "Cancel",
                                            onAction: () => setUpgradeModalOpen(false)
                                        }]}
                                    >
                                        <Modal.Section>
                                            <BlockStack gap="400">
                                                <Text as="p">
                                                    This feature is exclusively available on the <b>Pro</b> plan.
                                                </Text>
                                                <Text as="p" tone="subdued">
                                                    Upgrade now to unlock advanced bulk editing capabilities including Inventory, Tags, Metafields, Weight, and more.
                                                </Text>
                                            </BlockStack>
                                        </Modal.Section>
                                    </Modal>
                                </BlockStack>
                            </Card>

                            <Card>
                                {fieldToEdit === 'metafield' ? (
                                    <InlineGrid columns={{ xs: '1fr', md: '1fr 1fr' }} gap={{ xs: "300", md: "600" }} alignItems="start">
                                        {/* LEFT COLUMN: Selection */}
                                        <BlockStack gap="400">
                                            <Box padding={{ xs: "400", md: "500" }} background="bg-surface-secondary" borderRadius="300">
                                                <BlockStack gap="400">
                                                    <InlineStack align="space-between" blockAlign="center" wrap>
                                                        <Box>
                                                            <Select
                                                                label="Mode"
                                                                labelHidden
                                                                options={[
                                                                    { label: "Select existing", value: "0" },
                                                                    { label: "Create new", value: "1" },
                                                                ]}
                                                                value={metafieldMode.toString()}
                                                                onChange={(val) => setMetafieldMode(parseInt(val))}
                                                            />
                                                        </Box>
                                                        <InlineStack gap="300" blockAlign="center">
                                                            <RadioButton
                                                                label="Product"
                                                                checked={metafieldTargetType === 'product'}
                                                                id="target_product"
                                                                onChange={() => setMetafieldTargetType('product')}
                                                            />
                                                            <RadioButton
                                                                label="Variant"
                                                                checked={metafieldTargetType === 'variant'}
                                                                id="target_variant"
                                                                onChange={() => setMetafieldTargetType('variant')}
                                                            />
                                                        </InlineStack>
                                                    </InlineStack>

                                                    {metafieldMode === 0 ? (
                                                        <BlockStack gap="300">
                                                            <InlineStack gap="200" align="space-between" blockAlign="center">
                                                                <InlineStack gap="200">
                                                                    <Popover
                                                                        active={metafieldViewPopoverActive}
                                                                        activator={
                                                                            <Button
                                                                                onClick={() => setMetafieldViewPopoverActive(!metafieldViewPopoverActive)}
                                                                                disclosure
                                                                                size="slim"
                                                                            >
                                                                                View: {metafieldView === 'all' ? 'All' : metafieldView.charAt(0).toUpperCase() + metafieldView.slice(1)}
                                                                            </Button>
                                                                        }
                                                                        onClose={() => setMetafieldViewPopoverActive(false)}
                                                                    >
                                                                        <Box padding="200" width="200px">
                                                                            <ActionList
                                                                                items={[
                                                                                    { content: 'All definitions', active: metafieldView === 'all', onAction: () => { setMetafieldView('all'); setMetafieldViewPopoverActive(false); } },
                                                                                    { content: 'Favorites', icon: StarFilledIcon, active: metafieldView === 'favorites', onAction: () => { setMetafieldView('favorites'); setMetafieldViewPopoverActive(false); } },
                                                                                    { content: 'Recently used', icon: ClockIcon, active: metafieldView === 'recent', onAction: () => { setMetafieldView('recent'); setMetafieldViewPopoverActive(false); } },
                                                                                    { content: 'Text fields', active: metafieldView === 'text', onAction: () => { setMetafieldView('text'); setMetafieldViewPopoverActive(false); } },
                                                                                    { content: 'Number fields', active: metafieldView === 'number', onAction: () => { setMetafieldView('number'); setMetafieldViewPopoverActive(false); } },
                                                                                    { content: 'Boolean fields', active: metafieldView === 'boolean', onAction: () => { setMetafieldView('boolean'); setMetafieldViewPopoverActive(false); } },
                                                                                    { content: 'JSON fields', active: metafieldView === 'json', onAction: () => { setMetafieldView('json'); setMetafieldViewPopoverActive(false); } },
                                                                                ]}
                                                                            />
                                                                        </Box>
                                                                    </Popover>

                                                                    {metafieldPresets && metafieldPresets.length > 0 && (
                                                                        <Select
                                                                            label="Presets"
                                                                            labelHidden
                                                                            options={[
                                                                                { label: "Presets", value: "" },
                                                                                ...metafieldPresets.map((p: any) => ({ label: p.preset_name, value: p.id }))
                                                                            ]}
                                                                            value={selectedPreset || ""}
                                                                            onChange={(val) => {
                                                                                setSelectedPreset(val);
                                                                                const p = metafieldPresets.find((x: any) => x.id === val);
                                                                                if (p) {
                                                                                    setMetafieldTargetType(p.target.toLowerCase().includes('variant') ? 'variant' : 'product');
                                                                                    setMetafieldNamespace(p.namespace);
                                                                                    setMetafieldKey(p.key);
                                                                                    setMetafieldType(p.type);
                                                                                    setMetafieldMode(0);
                                                                                    setMetafieldSearchText("");
                                                                                }
                                                                            }}
                                                                        />
                                                                    )}
                                                                </InlineStack>
                                                            </InlineStack>

                                                            <Box position="relative">
                                                                <Combobox
                                                                    onClose={() => setIsDefinitionPopoverOpen(false)}
                                                                    activator={
                                                                        <Combobox.TextField
                                                                            onChange={(val) => {
                                                                                setMetafieldSearchText(val);
                                                                                if (val && !isDefinitionPopoverOpen) setIsDefinitionPopoverOpen(true);
                                                                            }}
                                                                            onFocus={() => setIsDefinitionPopoverOpen(true)}
                                                                            label="Search Definition"
                                                                            labelHidden
                                                                            value={metafieldSearchText}
                                                                            placeholder="e.g. Material"
                                                                            autoComplete="off"
                                                                            prefix={<Icon source={SearchIcon} />}
                                                                            suffix={selectedDefinition && (
                                                                                <Button
                                                                                    variant="plain"
                                                                                    icon={metafieldFavorites?.some((f: any) => f.namespace === selectedDefinition.namespace && f.key === selectedDefinition.key) ? StarFilledIcon : StarIcon}
                                                                                    onClick={() => {
                                                                                        const isFav = metafieldFavorites?.some((f: any) => f.namespace === selectedDefinition.namespace && f.key === selectedDefinition.key);
                                                                                        const formData = new FormData();
                                                                                        formData.append("intent", "toggle-metafield-favorite");
                                                                                        formData.append("namespace", selectedDefinition.namespace);
                                                                                        formData.append("key", selectedDefinition.key);
                                                                                        formData.append("type", selectedDefinition.type.name);
                                                                                        formData.append("target", metafieldTargetType === 'product' ? "PRODUCT" : "PRODUCTVARIANT");
                                                                                        formData.append("isFavorite", isFav ? "true" : "false");
                                                                                        favoriteFetcher.submit(formData, { method: "POST" });
                                                                                        window.shopify.toast.show(isFav ? "Removed from favorites" : "Added to favorites");
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        />
                                                                    }
                                                                >
                                                                    {filteredDefinitions.length > 0 ? (
                                                                        <Listbox onSelect={(val) => {
                                                                            const def = currentDefinitions.find((d: any) => d.id === val);
                                                                            updateMetafieldState(def);
                                                                            setMetafieldSearchText("");
                                                                            setIsDefinitionPopoverOpen(false);
                                                                        }}>
                                                                            {filteredDefinitions.map((def: any) => (
                                                                                <Listbox.Option
                                                                                    key={def.id}
                                                                                    value={def.id}
                                                                                    selected={selectedDefinition?.id === def.id}
                                                                                >
                                                                                    <Box padding="200">
                                                                                        <BlockStack gap="100">
                                                                                            <Text as="span" variant="bodyMd" fontWeight="bold" truncate>
                                                                                                {def.name}
                                                                                            </Text>
                                                                                            <Text as="span" variant="bodySm" tone="subdued" truncate>
                                                                                                {`${def.namespace}.${def.key}`}
                                                                                            </Text>
                                                                                            <Box>
                                                                                                <Badge size="small" tone="info">{def.type.name}</Badge>
                                                                                            </Box>
                                                                                        </BlockStack>
                                                                                    </Box>
                                                                                </Listbox.Option>
                                                                            ))}
                                                                        </Listbox>
                                                                    ) : null}
                                                                </Combobox>
                                                            </Box>

                                                            {selectedDefinition && (
                                                                <Box padding="200" background="bg-surface-active" borderRadius="200">
                                                                    <InlineStack gap="400" align="space-between">
                                                                        <Text as="p" tone="subdued" variant="bodySm">
                                                                            Full ID: <b>{`${selectedDefinition.namespace}.${selectedDefinition.key}`}</b>
                                                                        </Text>
                                                                        <Badge size="small" tone="attention">{selectedDefinition.type.name}</Badge>
                                                                    </InlineStack>
                                                                </Box>
                                                            )}

                                                            {selectedDefinition && (
                                                                <Banner tone="info">
                                                                    <BlockStack gap="200">
                                                                        <Text as="p" variant="bodySm">
                                                                            <b>API Access Required</b>
                                                                        </Text>
                                                                        <Text as="p" variant="bodySm" tone="subdued">
                                                                            Enable Storefront & Admin API access in: Shopify Admin → Settings → Custom Data → {metafieldTargetType === 'product' ? 'Products' : 'Variants'}
                                                                        </Text>
                                                                    </BlockStack>
                                                                </Banner>
                                                            )}
                                                        </BlockStack>
                                                    ) : (
                                                        <BlockStack gap="300">
                                                            <TextField
                                                                label="Metafield name"
                                                                value={metafieldSearchText}
                                                                onChange={(val) => {
                                                                    setMetafieldSearchText(val);
                                                                    // Auto-slugify key
                                                                    const slug = val.toLowerCase()
                                                                        .replace(/[^\w\s-]/g, '')
                                                                        .replace(/[\s_-]+/g, '_')
                                                                        .replace(/^-+|-+$/g, '');
                                                                    setMetafieldKey(slug);
                                                                }}
                                                                autoComplete="off"
                                                                placeholder="e.g. Shop by categories"
                                                                requiredIndicator
                                                            />

                                                            <Select
                                                                label="Type"
                                                                options={[
                                                                    { label: "Single line text", value: "single_line_text_field" },
                                                                    { label: "Multi line text", value: "multi_line_text_field" },
                                                                    { label: "Number (integer)", value: "number_integer" },
                                                                    { label: "Number (decimal)", value: "number_decimal" },
                                                                    { label: "True/False", value: "boolean" },
                                                                    { label: "Date", value: "date" },
                                                                    { label: "URL", value: "url" },
                                                                    { label: "JSON (advanced)", value: "json" },
                                                                ]}
                                                                value={metafieldType}
                                                                onChange={setMetafieldType}
                                                            />

                                                            <Box paddingBlockStart="200" paddingBlockEnd="200">
                                                                <Button
                                                                    variant="plain"
                                                                    onClick={() => setShowAdvancedMetafieldSettings(!showAdvancedMetafieldSettings)}
                                                                    icon={showAdvancedMetafieldSettings ? ChevronUpIcon : ChevronDownIcon}
                                                                >
                                                                    Advanced settings
                                                                </Button>
                                                            </Box>

                                                            {showAdvancedMetafieldSettings && (
                                                                <BlockStack gap="300">
                                                                    <InlineGrid columns={2} gap="300">
                                                                        <TextField label="Namespace" value={metafieldNamespace} onChange={setMetafieldNamespace} autoComplete="off" placeholder="custom" />
                                                                        <TextField label="Key" value={metafieldKey} onChange={setMetafieldKey} autoComplete="off" placeholder="shop_by_categories" />
                                                                    </InlineGrid>
                                                                    <TextField label="Description" value={metafieldDescription} onChange={setMetafieldDescription} autoComplete="off" multiline={3} />
                                                                </BlockStack>
                                                            )}

                                                            <Button
                                                                variant="primary"
                                                                loading={createDefFetcher.state === "submitting"}
                                                                disabled={!metafieldSearchText || !metafieldKey}
                                                                onClick={() => {
                                                                    const formData = new FormData();
                                                                    formData.append("intent", "create-metafield-definition");
                                                                    formData.append("name", metafieldSearchText);
                                                                    formData.append("namespace", metafieldNamespace);
                                                                    formData.append("key", metafieldKey);
                                                                    formData.append("type", metafieldType);
                                                                    formData.append("ownerType", metafieldTargetType === 'product' ? "PRODUCT" : "PRODUCTVARIANT");
                                                                    formData.append("description", metafieldDescription);
                                                                    createDefFetcher.submit(formData, { method: "POST" });
                                                                }}
                                                            >
                                                                {editValue ? "Create & apply" : "Create metafield"}
                                                            </Button>
                                                        </BlockStack>
                                                    )}
                                                </BlockStack>
                                            </Box>
                                        </BlockStack>

                                        {/* RIGHT COLUMN: Editor */}
                                        <BlockStack gap="400">
                                            <Box padding={{ xs: "400", md: "500" }} background="bg-surface" borderRadius="300" shadow="300">
                                                <BlockStack gap="300">
                                                    <Text variant="headingSm" as="h3">Update Logic</Text>
                                                    <Select
                                                        label="Edit method"
                                                        options={(() => {
                                                            const type = metafieldType;
                                                            if (type === 'boolean') {
                                                                return [
                                                                    { label: "Set true", value: "fixed_true" },
                                                                    { label: "Set false", value: "fixed_false" },
                                                                    { label: "Toggle value", value: "toggle_boolean" },
                                                                    { label: "Clear value", value: "clear_value" }
                                                                ];
                                                            }
                                                            if (type.includes('number') || type.includes('integer') || type.includes('decimal')) {
                                                                return [
                                                                    { label: "Set value", value: "fixed" },
                                                                    { label: "Increase by amount", value: "increase_number" },
                                                                    { label: "Decrease by amount", value: "decrease_number" },
                                                                    { label: "Increase by percent", value: "increase_percent" },
                                                                    { label: "Decrease by percent", value: "decrease_percent" },
                                                                    { label: "Clear value", value: "clear_value" }
                                                                ];
                                                            }
                                                            if (type.includes('text') || type === 'url') {
                                                                return [
                                                                    { label: "Set value", value: "fixed" },
                                                                    { label: "Append text", value: "append_text" },
                                                                    { label: "Prepend text", value: "prepend_text" },
                                                                    { label: "Clear value", value: "clear_value" }
                                                                ];
                                                            }
                                                            if (type === 'json') {
                                                                return [
                                                                    { label: "Set JSON", value: "fixed" },
                                                                    { label: "Clear value", value: "clear_value" }
                                                                ];
                                                            }
                                                            return [
                                                                { label: "Set value", value: "fixed" },
                                                                { label: "Clear value", value: "clear_value" }
                                                            ];
                                                        })()}
                                                        value={
                                                            (editMethod === 'fixed_true' || editMethod === 'fixed_false') ? 'fixed' :
                                                                (editMethod === 'replace_text') ? 'find_replace' :
                                                                    editMethod
                                                        }
                                                        onChange={(val) => {
                                                            if (metafieldType === 'boolean') {
                                                                if (val === 'fixed_true') setEditValue("true");
                                                                else if (val === 'fixed_false') setEditValue("false");
                                                                else if (val === 'fixed' && editValue !== 'true' && editValue !== 'false') setEditValue("true");
                                                            }
                                                            setEditMethod(val);
                                                        }}
                                                    />

                                                    {/* Dynamic Value Input */}
                                                    {editMethod !== 'clear_value' && editMethod !== 'toggle_boolean' && (
                                                        <BlockStack gap="200">
                                                            {metafieldType === 'boolean' ? (
                                                                <ChoiceList
                                                                    title="Select Value"
                                                                    choices={[
                                                                        { label: "True", value: "true" },
                                                                        { label: "False", value: "false" }
                                                                    ]}
                                                                    selected={[editValue]}
                                                                    onChange={(val) => setEditValue(val[0])}
                                                                />
                                                            ) : metafieldType === 'json' ? (
                                                                <TextField
                                                                    label="JSON Content"
                                                                    value={editValue}
                                                                    onChange={setEditValue}
                                                                    multiline={6}
                                                                    autoComplete="off"
                                                                    placeholder='{ "key": "value" }'
                                                                    helpText="Must be a valid JSON string"
                                                                />
                                                            ) : (
                                                                <TextField
                                                                    label={editMethod === 'prepend_text' ? "Prefix" : editMethod === 'append_text' ? "Suffix" : "Value"}
                                                                    value={editValue}
                                                                    onChange={setEditValue}
                                                                    type={(metafieldType.includes('number') || metafieldType.includes('integer') || metafieldType.includes('decimal')) ? 'number' : 'text'}
                                                                    multiline={metafieldType === 'multi_line_text_field' ? 4 : false}
                                                                    autoComplete="off"
                                                                    helpText={`Input for ${metafieldType}`}
                                                                />
                                                            )}
                                                        </BlockStack>
                                                    )}

                                                    <Divider />
                                                    {metafieldNamespace && metafieldKey && (
                                                        <Box paddingBlockStart="100">
                                                            <Button
                                                                size="slim"
                                                                variant="plain"
                                                                icon={StarIcon}
                                                                onClick={() => setIsPresetModalOpen(true)}
                                                            >
                                                                Save Preset
                                                            </Button>
                                                        </Box>
                                                    )}
                                                </BlockStack>
                                            </Box>
                                        </BlockStack>
                                    </InlineGrid>
                                ) : (
                                    <InlineGrid columns={{ xs: '1fr', md: '1fr 1fr' }} gap="400" alignItems="end">
                                        <BlockStack gap="400">
                                            {fieldToEdit === 'inventory' && (
                                                <Select
                                                    label="Inventory Location"
                                                    options={locations}
                                                    value={locationId}
                                                    onChange={setLocationId}
                                                    helpText="Select location to update."
                                                />
                                            )}
                                            <Select
                                                label="Edit method"
                                                options={(() => {
                                                    switch (fieldToEdit) {
                                                        case 'inventory':
                                                        case 'inventory_quantity':
                                                            return [
                                                                { label: "Set to fixed quantity", value: "fixed" },
                                                                { label: "Increase inventory", value: "amount_inc" },
                                                                { label: "Decrease inventory", value: "amount_dec" },
                                                            ];
                                                        case 'tags':
                                                            return [
                                                                { label: "Add tags", value: "add_tags" },
                                                                { label: "Remove tags", value: "remove_tags" },
                                                                { label: "Replace tags", value: "replace_tags" },
                                                            ];
                                                        case 'status':
                                                            return [
                                                                { label: "Set status", value: "fixed" },
                                                            ];
                                                        case 'inventory_policy':
                                                            return [
                                                                { label: "Set policy", value: "fixed" },
                                                            ];
                                                        case 'requires_shipping':
                                                        case 'taxable':
                                                        case 'published':
                                                            return [
                                                                { label: "Set value", value: "fixed" },
                                                            ];
                                                        case 'vendor':
                                                        case 'product_type':
                                                        case 'title':
                                                        case 'body_html':
                                                        case 'handle':
                                                        case 'template_suffix':
                                                        case 'sku':
                                                        case 'barcode':
                                                        case 'seo_title':
                                                        case 'seo_description':
                                                        case 'google_product_category':
                                                        case 'google_custom_label_0':
                                                        case 'google_custom_label_1':
                                                        case 'google_custom_label_2':
                                                        case 'google_custom_label_3':
                                                        case 'google_custom_label_4':
                                                        case 'google_age_group':
                                                        case 'google_gender':
                                                        case 'google_color':
                                                        case 'google_size':
                                                        case 'google_material':
                                                        case 'google_pattern':
                                                        case 'google_condition':
                                                        case 'google_mpn':
                                                        case 'google_brand':
                                                        case 'google_item_group_id':
                                                        case 'google_custom_product':
                                                        case 'hs_code':
                                                        case 'country_of_origin':
                                                        case 'weight_unit':
                                                        case 'option1_name':
                                                        case 'option2_name':
                                                        case 'option3_name':
                                                            return [
                                                                { label: "Set new value", value: "fixed" },
                                                                { label: "Find and replace text", value: "find_replace" },
                                                                { label: "Add text to beginning (Prefix)", value: "add_prefix" },
                                                                { label: "Add text to end (Suffix)", value: "add_suffix" },
                                                                { label: "Clear value", value: "clear_value" },
                                                            ];
                                                        case 'manual_collection':
                                                            return [
                                                                { label: "Add to collection", value: "add_to_collection" },
                                                                { label: "Remove from collection", value: "remove_from_collection" },
                                                            ];
                                                        case 'sales_channels':
                                                        case 'market_publishing':
                                                            return [
                                                                { label: "Publish", value: "publish" },
                                                                { label: "Unpublish", value: "unpublish" },
                                                            ];
                                                        case 'images':
                                                            return [
                                                                { label: "Add new image from URL", value: "add_image" },
                                                                { label: "Set image from URL (Replace)", value: "set_image" },
                                                                { label: "Clear all images", value: "clear_images" },
                                                            ];
                                                        case 'add_variants':
                                                            return [{ label: "Add new variant (Title;Price;SKU;Opt1;Opt2;Opt3)", value: "add_variant" }];
                                                        case 'add_options':
                                                            return [{ label: "Add new product option (Name;Values)", value: "add_option" }];
                                                        case 'delete_variants':
                                                            return [{ label: "Delete selected variants", value: "delete_variants" }];
                                                        case 'delete_products':
                                                            return [{ label: "Delete selected products", value: "delete_products" }];
                                                        case 'sort_variants':
                                                            return [{ label: "Sort variants (logic-based)", value: "sort_variants" }];
                                                        case 'reorder_options':
                                                            return [{ label: "Reorder options (manual)", value: "reorder_options" }];
                                                        case 'variant_management':
                                                            return [
                                                                { label: "Add new variant", value: "add_variant" },
                                                                { label: "Sort variants", value: "sort_variants" },
                                                                { label: "Add new product option", value: "add_option" },
                                                            ];
                                                        case 'weight':
                                                            return [
                                                                { label: "Set to fixed weight", value: "fixed" },
                                                                { label: "Increase weight", value: "amount_inc" },
                                                                { label: "Decrease weight", value: "amount_dec" },
                                                            ];
                                                        case 'cost':
                                                            return [
                                                                { label: "Set cost to the current product price", value: "set_to_price" },
                                                                { label: "Set cost to the current compare-at price", value: "set_to_compare_at" },
                                                                { label: "Increase cost by (%)", value: "percentage_inc" },
                                                                { label: "Decrease cost by (%)", value: "percentage_dec" },
                                                                { label: "Increase cost by (fixed amount)", value: "amount_inc" },
                                                                { label: "Decrease cost by (fixed amount)", value: "amount_dec" },
                                                                { label: "Set cost to a fixed value", value: "fixed" },
                                                            ];
                                                        case 'compare_price':
                                                            return [
                                                                { label: "Set to fixed value", value: "fixed" },
                                                                { label: "Decrease by amount", value: "amount_dec" },
                                                                { label: "Increase by amount", value: "amount_inc" },
                                                                { label: "Decrease by percentage", value: "percentage_dec" },
                                                                { label: "Increase by percentage", value: "percentage_inc" },
                                                                { label: "Set as percentage of price", value: "percentage_of_price" },
                                                                { label: "Set to current price", value: "set_to_price" },
                                                                { label: "Set as percentage of compare at price", value: "percentage_of_compare_at" },
                                                                { label: "Set to current cost price", value: "set_to_cost" },
                                                                { label: "Set as percentage of cost price", value: "percentage_of_cost" },
                                                            ];
                                                        default: // Price
                                                            return [
                                                                { label: "Set to fixed value", value: "fixed" },
                                                                { label: "Decrease by amount", value: "amount_dec" },
                                                                { label: "Increase by amount", value: "amount_inc" },
                                                                { label: "Decrease by percentage", value: "percentage_dec" },
                                                                { label: "Increase by percentage", value: "percentage_inc" },
                                                                { label: "Set as percentage of price", value: "percentage_of_price" },
                                                                { label: "Set the price to the current compare-at price", value: "set_to_compare_at" },
                                                                { label: "Set as percentage of compare at price", value: "percentage_of_compare_at" },
                                                                { label: "Set the price to the current cost price", value: "set_to_cost" },
                                                                { label: "Set as percentage of cost price", value: "percentage_of_cost" },
                                                            ];
                                                    }
                                                })()}
                                                value={editMethod}
                                                onChange={setEditMethod}
                                            />
                                        </BlockStack>
                                        <BlockStack gap="100">

                                            {fieldToEdit === 'inventory_policy' ? (
                                                <Select
                                                    label="Inventory Policy"
                                                    options={[
                                                        { label: "Continue selling when out of stock", value: "CONTINUE" },
                                                        { label: "Stop selling when out of stock", value: "DENY" },
                                                    ]}
                                                    value={editValue}
                                                    onChange={setEditValue}
                                                />
                                            ) : fieldToEdit === 'status' ? (
                                                <Select
                                                    label="Status value"
                                                    options={[
                                                        { label: "Active", value: "ACTIVE" },
                                                        { label: "Draft", value: "DRAFT" },
                                                        { label: "Archived", value: "ARCHIVED" },
                                                    ]}
                                                    value={editValue}
                                                    onChange={setEditValue}
                                                />
                                            ) : fieldToEdit === 'tags' ? (
                                                <>
                                                    <MultiTagSelect
                                                        selectedTags={editValue ? editValue.split(",").filter(Boolean) : []}
                                                        onChange={(tags) => {
                                                            const newVal = tags.join(",");
                                                            setEditValue(newVal);
                                                        }}
                                                        availableTags={productTags}
                                                        placeholder="Search or add tags"
                                                    />
                                                </>
                                            ) : (['requires_shipping', 'taxable'].includes(fieldToEdit)) ? (
                                                <Select
                                                    label="Value"
                                                    options={[
                                                        { label: "True", value: "true" },
                                                        { label: "False", value: "false" },
                                                    ]}
                                                    value={editValue}
                                                    onChange={setEditValue}
                                                />
                                            ) : (fieldToEdit === 'published') ? (
                                                <Select
                                                    label="Value"
                                                    options={[
                                                        { label: "Hidden", value: "true" },
                                                        { label: "Visible", value: "false" },
                                                    ]}
                                                    value={editValue}
                                                    onChange={setEditValue}
                                                />
                                            ) : (fieldToEdit === 'inventory_policy') ? (
                                                <Select
                                                    label="Value"
                                                    options={[
                                                        { label: "Deny", value: "deny" },
                                                        { label: "Continue", value: "continue" },
                                                    ]}
                                                    value={editValue}
                                                    onChange={setEditValue}
                                                />
                                            ) : fieldToEdit === 'weight' ? (
                                                <InlineStack gap="200" align="start">
                                                    <Box width="100%">
                                                        <TextField
                                                            label="Value"
                                                            type="number"
                                                            value={editValue}
                                                            onChange={setEditValue}
                                                            autoComplete="off"
                                                        />
                                                    </Box>
                                                    <Box minWidth="100px">
                                                        <Select
                                                            label="Unit"
                                                            options={[
                                                                { label: "kg", value: "kg" },
                                                                { label: "g", value: "g" },
                                                                { label: "lb", value: "lb" },
                                                                { label: "oz", value: "oz" },
                                                            ]}
                                                            value={weightUnit}
                                                            onChange={setWeightUnit}
                                                        />
                                                    </Box>
                                                </InlineStack>
                                            ) : (['vendor', 'product_type', 'title', 'body_html', 'handle', 'template_suffix', 'sku', 'barcode', 'seo_title', 'seo_description', 'google_product_category', 'google_custom_label_0', 'google_custom_label_1', 'google_custom_label_2', 'google_custom_label_3', 'google_custom_label_4'].includes(fieldToEdit)) ? (
                                                <BlockStack gap="300">
                                                    {(['set_vendor', 'set_type', 'fixed'].includes(editMethod)) && (
                                                        <TextField
                                                            label={fieldToEdit === 'vendor' ? "Vendor Value" : (fieldToEdit === 'product_type' ? "Product Type Value" : "Value")}
                                                            value={editValue}
                                                            onChange={setEditValue}
                                                            autoComplete="off"
                                                        />
                                                    )}
                                                    {editMethod === 'add_prefix' && (
                                                        <TextField
                                                            label="Prefix Value"
                                                            value={editValue}
                                                            onChange={setEditValue}
                                                            autoComplete="off"
                                                        />
                                                    )}
                                                    {editMethod === 'add_suffix' && (
                                                        <TextField
                                                            label="Suffix Value"
                                                            value={editValue}
                                                            onChange={setEditValue}
                                                            autoComplete="off"
                                                        />
                                                    )}
                                                    {(editMethod === 'find_replace' || editMethod === 'replace_text') && (
                                                        <InlineStack gap="300">
                                                            <Box width="45%">
                                                                <TextField
                                                                    label="Find Text"
                                                                    value={findText}
                                                                    onChange={setFindText}
                                                                    autoComplete="off"
                                                                />
                                                            </Box>
                                                            <Box width="45%">
                                                                <TextField
                                                                    label="Replace Text"
                                                                    value={replaceText}
                                                                    onChange={setReplaceText}
                                                                    autoComplete="off"
                                                                />
                                                            </Box>
                                                        </InlineStack>
                                                    )}
                                                    {(editMethod === 'clear_vendor' || editMethod === 'clear_value' || editMethod === 'clear_type') && (
                                                        <Text as="p" variant="bodyMd">{fieldToEdit === 'vendor' ? "Vendor" : (fieldToEdit === 'product_type' ? "Product type" : "Value")} will be cleared.</Text>
                                                    )}
                                                </BlockStack>
                                            ) : (
                                                !['set_to_compare_at', 'set_to_cost', 'set_to_price', 'set_to_null'].includes(editMethod) && (
                                                    <TextField
                                                        label="Value"
                                                        type="number"
                                                        value={editValue}
                                                        onChange={setEditValue}
                                                        prefix={(editMethod.includes("percentage") || ['metafield', 'tags', 'status'].includes(fieldToEdit)) ? "" : currencySymbol}
                                                        suffix={editMethod.includes("percentage") ? "%" : ""}
                                                        autoComplete="off"
                                                    />
                                                )
                                            )}
                                        </BlockStack>
                                    </InlineGrid>
                                )}
                            </Card>

                            {['price', 'compare_price', 'cost'].includes(fieldToEdit) && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Rounding</Text>
                                        <Select
                                            label="Rounding"
                                            options={[
                                                { label: "Round to nearest .01", value: "nearest_01" },
                                                { label: "Round to nearest whole number", value: "nearest_whole" },
                                                { label: "End prices in .99", value: "nearest_99" },
                                                { label: "End prices in a certain number", value: "custom_ending" },
                                                { label: "Don't round", value: "none" },
                                            ]}
                                            value={rounding}
                                            onChange={setRounding}
                                            helpText={
                                                rounding === 'nearest_01'
                                                    ? "Round to two decimal places. For example, a price of 10.458 would be rounded to 10.46"
                                                    : rounding === 'nearest_whole'
                                                        ? "Prices will be rounded to the nearest whole number (e.g. 10.00)"
                                                        : rounding === 'nearest_99'
                                                            ? "Round the final price to always end in .99. For example, a price of 10.458 would be rounded to 10.99"
                                                            : rounding === 'custom_ending'
                                                                ? "Round the final price to always end in a specific number. For example, if you enter 95, a price of 10.458 would be rounded to 10.95"
                                                                : "Prices will be rounded after the adjustment is applied."
                                            }
                                        />
                                        {rounding === 'custom_ending' && (
                                            <TextField
                                                label="Ending cents (e.g., 95 for .95)"
                                                type="number"
                                                value={roundingValue}
                                                onChange={setRoundingValue}
                                                maxLength={2}
                                                autoComplete="off"
                                                suffix="cents"
                                            />
                                        )}
                                    </BlockStack>
                                </Card>
                            )}

                            {fieldToEdit === 'price' && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Compare at price</Text>
                                        <BlockStack gap="200">
                                            <RadioButton
                                                label="Don't change compare-at price"
                                                checked={compareAtPriceOption === "none"}
                                                id="none"
                                                name="compareAt"
                                                onChange={() => setCompareAtPriceOption("none")}
                                            />
                                            <RadioButton
                                                label="Set the compare-at price"
                                                checked={compareAtPriceOption === "set"}
                                                id="set"
                                                name="compareAt"
                                                onChange={() => setCompareAtPriceOption("set")}
                                            />
                                            {compareAtPriceOption === "set" && (
                                                <Box paddingBlockStart="200" paddingInlineStart="600">
                                                    <InlineStack gap="400" wrap={false} blockAlign="end">
                                                        <Box width="50%">
                                                            <Select
                                                                label="Edit method"
                                                                options={[
                                                                    { label: "Set to fixed value", value: "fixed" },
                                                                    { label: "Decrease by amount", value: "amount_dec" },
                                                                    { label: "Increase by amount", value: "amount_inc" },
                                                                    { label: "Decrease by percentage", value: "percentage_dec" },
                                                                    { label: "Increase by percentage", value: "percentage_inc" },
                                                                    { label: "Set the compare-at price to the current price", value: "set_to_price" },
                                                                    { label: "Set as percentage of price", value: "percentage_of_price" },
                                                                    { label: "Set as percentage of compare at price", value: "percentage_of_compare_at" },
                                                                    { label: "Set the compare-at price to the current cost price", value: "set_to_cost" },
                                                                    { label: "Set as percentage of cost price", value: "percentage_of_cost" },
                                                                    { label: "Set to null/blank", value: "set_to_null" },
                                                                ]}
                                                                value={compareAtEditMethod}
                                                                onChange={setCompareAtEditMethod}
                                                            />
                                                        </Box>
                                                        {compareAtEditMethod !== 'set_to_null' && compareAtEditMethod !== 'set_to_price' && compareAtEditMethod !== 'set_to_cost' && (
                                                            <Box width="50%">
                                                                <TextField
                                                                    label="Value"
                                                                    type="number"
                                                                    value={compareAtEditValue}
                                                                    onChange={setCompareAtEditValue}
                                                                    prefix={(compareAtEditMethod.includes("percentage")) ? "" : currencySymbol}
                                                                    suffix={compareAtEditMethod.includes("percentage") ? "%" : ""}
                                                                    autoComplete="off"
                                                                />
                                                            </Box>
                                                        )}
                                                    </InlineStack>
                                                </Box>
                                            )}
                                        </BlockStack>
                                    </BlockStack>
                                </Card>
                            )}

                            {fieldToEdit === 'compare_price' && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Price</Text>
                                        <BlockStack gap="200">
                                            <RadioButton
                                                label="Don't change price"
                                                checked={priceOption === "none"}
                                                id="price_none"
                                                name="priceOption"
                                                onChange={() => setPriceOption("none")}
                                            />
                                            <RadioButton
                                                label="Set the price"
                                                checked={priceOption === "set"}
                                                id="price_set"
                                                name="priceOption"
                                                onChange={() => setPriceOption("set")}
                                            />
                                            {priceOption === "set" && (
                                                <Box paddingBlockStart="200" paddingInlineStart="600">
                                                    <InlineStack gap="400" wrap={false} blockAlign="end">
                                                        <Box width="50%">
                                                            <Select
                                                                label="Edit method"
                                                                options={[
                                                                    { label: "Set to fixed value", value: "fixed" },
                                                                    { label: "Decrease by amount", value: "amount_dec" },
                                                                    { label: "Increase by amount", value: "amount_inc" },
                                                                    { label: "Decrease by percentage", value: "percentage_dec" },
                                                                    { label: "Increase by percentage", value: "percentage_inc" },
                                                                    { label: "Set as percentage of price", value: "percentage_of_price" },
                                                                    { label: "Set the price to the current compare-at price", value: "set_to_compare_at" },
                                                                    { label: "Set as percentage of compare at price", value: "percentage_of_compare_at" },
                                                                    { label: "Set the price to the current cost price", value: "set_to_cost" },
                                                                    { label: "Set as percentage of cost price", value: "percentage_of_cost" },
                                                                ]}
                                                                value={priceEditMethod}
                                                                onChange={setPriceEditMethod}
                                                            />
                                                        </Box>
                                                        {priceEditMethod !== 'set_to_compare_at' && priceEditMethod !== 'set_to_cost' && (
                                                            <Box width="50%">
                                                                <TextField
                                                                    label="Value"
                                                                    type="number"
                                                                    value={priceEditValue}
                                                                    onChange={setPriceEditValue}
                                                                    prefix={(priceEditMethod.includes("percentage")) ? "" : currencySymbol}
                                                                    suffix={priceEditMethod.includes("percentage") ? "%" : ""}
                                                                    autoComplete="off"
                                                                />
                                                            </Box>
                                                        )}
                                                    </InlineStack>
                                                </Box>
                                            )}
                                        </BlockStack>
                                    </BlockStack>
                                </Card>
                            )}

                            {['price', 'compare_price'].includes(fieldToEdit) && (
                                < Card >
                                    <BlockStack gap="200">
                                        <Checkbox
                                            label="Apply this price change to specific Shopify markets"
                                            checked={applyToMarkets}
                                            onChange={(val) => {
                                                setApplyToMarkets(val);
                                                if (val) setApplyToBasePrice(false);
                                            }}
                                        />
                                        {applyToMarkets && (
                                            <Box paddingBlockStart="200" paddingInlineStart="600">
                                                <ChoiceList
                                                    title="Select markets"
                                                    titleHidden
                                                    allowMultiple
                                                    choices={markets.map((m: any) => ({
                                                        label: m.name,
                                                        value: m.handle
                                                    }))}
                                                    selected={selectedMarkets}
                                                    onChange={(val) => {
                                                        setSelectedMarkets(val);
                                                        if (val.length > 0 && selectedPreviewMarket === "base") {
                                                            setSelectedPreviewMarket(val[0]);
                                                        }
                                                    }}
                                                />
                                                <Box paddingBlockStart="200">
                                                    <Checkbox
                                                        label="Apply to Base Price?"
                                                        helpText="When this option is disabled, the change applies only to selected markets without altering the base price"
                                                        checked={applyToBasePrice}
                                                        onChange={setApplyToBasePrice}
                                                    />
                                                </Box>
                                            </Box>
                                        )}
                                    </BlockStack>
                                </Card>
                            )}

                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Apply to products</Text>
                                    <ChoiceList
                                        title="Product selection"
                                        titleHidden
                                        choices={[
                                            { label: "All products", value: "all" },
                                            { label: "Collections", value: "collections" },
                                            { label: "Specific products", value: "specific" },
                                            { label: "Match conditions", value: "conditions" },
                                        ]}
                                        selected={[applyToProducts]}
                                        onChange={(val) => setApplyToProducts(val[0])}
                                    />
                                    {applyToProducts !== "all" && applyToProducts !== "conditions" && (
                                        <Box paddingBlockStart="200">
                                            <Button
                                                variant="secondary"
                                                onClick={applyToProducts === "collections" ? selectCollections : selectProducts}
                                            >
                                                {applyToProducts === "collections"
                                                    ? (selectedCollections.length > 0 ? `${selectedCollections.length} collections selected` : "Browse collections")
                                                    : (selectedProducts.length > 0 ? `${selectedProducts.length} products selected` : "Browse products")
                                                }
                                            </Button>
                                        </Box>
                                    )}
                                    {applyToProducts === "conditions" && (
                                        <Box paddingBlockStart="400">
                                            <BlockStack gap="300">
                                                <Box paddingBlockEnd="200">
                                                    <BlockStack gap="200">
                                                        <Text as="span" variant="bodyMd">Products must match:</Text>
                                                        <InlineStack gap="400">
                                                            <RadioButton
                                                                label="all conditions"
                                                                checked={productMatchLogic === 'all'}
                                                                id="all_conditions_product"
                                                                name="productMatchLogic"
                                                                onChange={() => setProductMatchLogic('all')}
                                                            />
                                                            <RadioButton
                                                                label="any condition"
                                                                checked={productMatchLogic === 'any'}
                                                                id="any_condition_product"
                                                                name="productMatchLogic"
                                                                onChange={() => setProductMatchLogic('any')}
                                                            />
                                                        </InlineStack>
                                                    </BlockStack>
                                                </Box>
                                                {productConditions.map((condition, index) => (
                                                    <InlineStack key={index} gap="200" align="start">
                                                        <Box minWidth="120px">
                                                            <Select
                                                                label="Property"
                                                                labelHidden
                                                                options={[
                                                                    { label: "Title", value: "title" },
                                                                    { label: "Status", value: "status" },
                                                                    { label: "Handle", value: "handle" },
                                                                    { label: "Collection", value: "collection" },
                                                                    { label: "Product type", value: "type" },
                                                                    { label: "Product vendor", value: "vendor" },
                                                                    { label: "Product tag", value: "tag" },
                                                                    { label: "Created at", value: "created_at" },
                                                                    { label: "Updated at", value: "updated_at" },
                                                                    { label: "Variant Price", value: "item_price" },
                                                                    { label: "Total Inventory", value: "inventory_total" },
                                                                    { label: "Metafield", value: "metafield" },
                                                                ]}
                                                                value={condition.property}
                                                                onChange={(val) => handleProductPropertyChange(index, val)}
                                                            />
                                                        </Box>
                                                        {condition.property === 'metafield' && (
                                                            <BlockStack gap="200">
                                                                <Box minWidth="250px">
                                                                    <MetafieldConditionPicker
                                                                        selectedNamespace={condition.metafieldNamespace}
                                                                        selectedKey={condition.originalKey || (condition.metafieldKey?.includes('.') ? condition.metafieldKey.split('.')[1] : condition.metafieldKey)}
                                                                        onChange={(ns, key, type, ownerType) => {
                                                                            updateProductCondition(index, {
                                                                                metafieldNamespace: ns,
                                                                                metafieldKey: `${ns}.${key}`,
                                                                                originalKey: key,
                                                                                metafieldType: type,
                                                                                metafieldOwnerType: ownerType
                                                                            });
                                                                        }}
                                                                        productDefinitions={productMetafieldDefinitions}
                                                                        variantDefinitions={variantMetafieldDefinitions}
                                                                    />
                                                                </Box>
                                                                <Text as="p" tone="subdued" variant="bodySm">
                                                                    Note: "Filter on product list" must be enabled in Shopify Admin settings for this metafield.
                                                                </Text>
                                                            </BlockStack>
                                                        )}
                                                        <Box minWidth="120px">
                                                            <Select
                                                                label="Operator"
                                                                labelHidden
                                                                options={(() => {
                                                                    const textOperators = [
                                                                        { label: "contains", value: "contains" },
                                                                        { label: "equals", value: "equals" },
                                                                        { label: "starts with", value: "starts_with" },
                                                                        { label: "ends with", value: "ends_with" },
                                                                    ];
                                                                    const numericOperators = [
                                                                        { label: "equals", value: "equals" },
                                                                        { label: "greater than", value: "greater_than" },
                                                                        { label: "less than", value: "less_than" },
                                                                    ];

                                                                    if (['item_price', 'inventory_total', 'created_at', 'updated_at'].includes(condition.property)) {
                                                                        return numericOperators;
                                                                    }
                                                                    if (['status', 'collection', 'type', 'vendor'].includes(condition.property)) {
                                                                        return [{ label: "is", value: "equals" }];
                                                                    }
                                                                    return textOperators;
                                                                })()}
                                                                value={condition.operator}
                                                                onChange={(val) => updateProductCondition(index, "operator", val)}
                                                            />
                                                        </Box>
                                                        <Box minWidth="150px">
                                                            {(() => {
                                                                if (condition.property === 'status') {
                                                                    return (
                                                                        <Select
                                                                            label="Status"
                                                                            labelHidden
                                                                            options={[
                                                                                { label: "Active", value: "active" },
                                                                                { label: "Draft", value: "draft" },
                                                                                { label: "Archived", value: "archived" },
                                                                            ]}
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                        />
                                                                    );
                                                                }
                                                                if (condition.property === 'collection') {
                                                                    return (
                                                                        <Select
                                                                            label="Collection"
                                                                            labelHidden
                                                                            options={collections.map((c: any) => ({ label: c.title, value: c.id.split("/").pop() }))}
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                        />
                                                                    );
                                                                }
                                                                if (condition.property === 'type') {
                                                                    return (
                                                                        <Select
                                                                            label="Product type"
                                                                            labelHidden
                                                                            options={productTypes.map((t: string) => ({ label: t || "No type", value: t }))}
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                        />
                                                                    );
                                                                }
                                                                if (condition.property === 'vendor') {
                                                                    return (
                                                                        <Select
                                                                            label="Product vendor"
                                                                            labelHidden
                                                                            options={productVendors.map((v: string) => ({ label: v || "No vendor", value: v }))}
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                        />
                                                                    );
                                                                }
                                                                if (condition.property === 'created_at' || condition.property === 'updated_at') {
                                                                    return (
                                                                        <TextField
                                                                            label="Date"
                                                                            labelHidden
                                                                            type="date"
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                            autoComplete="off"
                                                                        />
                                                                    );
                                                                }
                                                                if (['item_price', 'inventory_total'].includes(condition.property)) {
                                                                    return (
                                                                        <TextField
                                                                            label="Value"
                                                                            labelHidden
                                                                            type="number"
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                            autoComplete="off"
                                                                        />
                                                                    );
                                                                }
                                                                if (condition.property === 'tag') {
                                                                    return (
                                                                        <TagConditionInput
                                                                            value={condition.value}
                                                                            onChange={(val) => updateProductCondition(index, "value", val)}
                                                                            availableTags={productTags}
                                                                        />
                                                                    );
                                                                }
                                                                return (
                                                                    <TextField
                                                                        label="Value"
                                                                        labelHidden
                                                                        value={condition.value}
                                                                        onChange={(val) => updateProductCondition(index, "value", val)}
                                                                        autoComplete="off"
                                                                    />
                                                                );
                                                            })()}
                                                        </Box>
                                                        <Button variant="tertiary" tone="critical" onClick={() => removeProductCondition(index)}>Remove</Button>
                                                    </InlineStack>
                                                ))}
                                                <Box>
                                                    <Button onClick={addProductCondition}>Add condition</Button>
                                                </Box>
                                            </BlockStack>
                                        </Box>
                                    )}
                                </BlockStack>
                            </Card>

                            <Card>
                                <BlockStack gap="200">
                                    <Checkbox
                                        label="Exclude specific products"
                                        checked={excludeSpecificProducts}
                                        onChange={setExcludeSpecificProducts}
                                    />
                                    {excludeSpecificProducts && (
                                        <Box paddingBlockStart="200">
                                            <Button variant="secondary" onClick={selectExcludedProducts}>
                                                {excludedProductsList.length > 0
                                                    ? `${excludedProductsList.length} products excluded`
                                                    : "Browse products to exclude"
                                                }
                                            </Button>
                                        </Box>
                                    )}
                                </BlockStack>
                            </Card>

                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Apply to variants</Text>
                                    <ChoiceList
                                        title="Variant selection"
                                        titleHidden
                                        choices={[
                                            { label: "All variants", value: "all" },
                                            { label: "Match conditions", value: "conditions" },
                                        ]}
                                        selected={[applyToVariants]}
                                        onChange={(val) => setApplyToVariants(val[0])}
                                    />
                                    {applyToVariants === "conditions" && (
                                        <Box paddingBlockStart="400">
                                            <BlockStack gap="300">
                                                <Box paddingBlockEnd="200">
                                                    <BlockStack gap="200">
                                                        <Text as="span" variant="bodyMd">Variant must match:</Text>
                                                        <InlineStack gap="400">
                                                            <RadioButton
                                                                label="all conditions"
                                                                checked={variantMatchLogic === 'all'}
                                                                id="all_conditions_variant"
                                                                name="variantMatchLogic"
                                                                onChange={() => setVariantMatchLogic('all')}
                                                            />
                                                            <RadioButton
                                                                label="any condition"
                                                                checked={variantMatchLogic === 'any'}
                                                                id="any_condition_variant"
                                                                name="variantMatchLogic"
                                                                onChange={() => setVariantMatchLogic('any')}
                                                            />
                                                        </InlineStack>
                                                    </BlockStack>
                                                </Box>
                                                {variantConditions.map((condition, index) => (
                                                    <InlineStack key={index} gap="200" align="start">
                                                        <Box minWidth="120px">
                                                            <Select
                                                                label="Property"
                                                                labelHidden
                                                                options={[
                                                                    { label: "Variant title", value: "title" },
                                                                    { label: "SKU", value: "sku" },
                                                                    { label: "Price", value: "price" },
                                                                    { label: "Compare at price", value: "compare_at" },
                                                                    { label: "Inventory", value: "inventory" },
                                                                    { label: "Option name", value: "option_name" },
                                                                    { label: "Option value", value: "option_value" },
                                                                ]}
                                                                value={condition.property}
                                                                onChange={(val) => handleVariantPropertyChange(index, val)}
                                                            />
                                                        </Box>
                                                        <Box minWidth="120px">
                                                            <Select
                                                                label="Operator"
                                                                labelHidden
                                                                options={(() => {
                                                                    const textOperators = [
                                                                        { label: "contains", value: "contains" },
                                                                        { label: "equals", value: "equals" },
                                                                        { label: "starts with", value: "starts_with" },
                                                                        { label: "ends with", value: "ends_with" },
                                                                    ];
                                                                    const numericOperators = [
                                                                        { label: "equals", value: "equals" },
                                                                        { label: "greater than", value: "greater_than" },
                                                                        { label: "less than", value: "less_than" },
                                                                    ];

                                                                    if (['price', 'compare_at', 'inventory'].includes(condition.property)) {
                                                                        return numericOperators;
                                                                    }
                                                                    return textOperators;
                                                                })()}
                                                                value={condition.operator}
                                                                onChange={(val) => updateVariantCondition(index, "operator", val)}
                                                            />
                                                        </Box>
                                                        <Box minWidth="150px">
                                                            {(() => {
                                                                if (['price', 'compare_at', 'inventory'].includes(condition.property)) {
                                                                    return (
                                                                        <TextField
                                                                            label="Value"
                                                                            labelHidden
                                                                            type="number"
                                                                            value={condition.value}
                                                                            onChange={(val) => updateVariantCondition(index, "value", val)}
                                                                            autoComplete="off"
                                                                        />
                                                                    );
                                                                }
                                                                return (
                                                                    <TextField
                                                                        label="Value"
                                                                        labelHidden
                                                                        value={condition.value}
                                                                        onChange={(val) => updateVariantCondition(index, "value", val)}
                                                                        autoComplete="off"
                                                                    />
                                                                );
                                                            })()}
                                                        </Box>
                                                        <Button variant="tertiary" tone="critical" onClick={() => removeVariantCondition(index)}>Remove</Button>
                                                    </InlineStack>
                                                ))}
                                                <Box>
                                                    <Button onClick={addVariantCondition}>Add condition</Button>
                                                </Box>
                                            </BlockStack>
                                        </Box>
                                    )}
                                </BlockStack>
                            </Card>

                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Start time</Text>
                                    <ChoiceList
                                        title="Start time selection"
                                        titleHidden
                                        choices={[
                                            { label: "Now", value: "now" },
                                            { label: "Schedule the edit", value: "schedule" },
                                            { label: "Manual", value: "manual" },
                                        ]}
                                        selected={[startTime]}
                                        onChange={(val) => {
                                            const newVal = val[0];
                                            setStartTime(newVal);
                                            // Refresh scheduled time to current if switching to schedule
                                            if (newVal === 'schedule') {
                                                const current = getInitialTime();
                                                setScheduledStartTime(current);
                                                setTimeInputValue(formatTo12Hour(current));
                                                // If date is in past, reset to today
                                                if (new Date(scheduledStartDate.start).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0)) {
                                                    setScheduledStartDate({ start: new Date(), end: new Date() });
                                                }
                                            }
                                        }}
                                    />
                                    {startTime === "schedule" && (
                                        <Box paddingBlockStart="200">
                                            <BlockStack gap="300">
                                                <InlineGrid columns={2} gap="400">
                                                    <Popover
                                                        active={popoverActive}
                                                        activator={
                                                            <TextField
                                                                label="Date"
                                                                value={formatDate(scheduledStartDate.start)}
                                                                onFocus={togglePopoverActive}
                                                                autoComplete="off"
                                                                suffix={<Icon source={CalendarIcon} />}
                                                            />
                                                        }
                                                        onClose={togglePopoverActive}
                                                        preferredAlignment="left"
                                                    >
                                                        <Box padding="400">
                                                            <DatePicker
                                                                month={month}
                                                                year={year}
                                                                onChange={(range) => {
                                                                    setScheduledStartDate(range);
                                                                    togglePopoverActive();
                                                                }}
                                                                onMonthChange={(m, y) => setDate({ month: m, year: y })}
                                                                selected={scheduledStartDate}
                                                            />
                                                        </Box>
                                                    </Popover>
                                                    <Popover
                                                        active={startTimePopoverActive}
                                                        activator={
                                                            <div onClick={toggleStartTimePopoverActive} className={startTimePopoverActive ? "time-picker-active" : ""}>
                                                                <TextField
                                                                    label="Time"
                                                                    value={timeInputValue}
                                                                    autoComplete="off"
                                                                    suffix={<Icon source={ClockIcon} />}
                                                                    readonly
                                                                />
                                                            </div>
                                                        }
                                                        onClose={toggleStartTimePopoverActive}
                                                        preferredAlignment="left"
                                                    >
                                                        <TimePickerContent
                                                            value={scheduledStartTime}
                                                            onChange={(val: string) => {
                                                                setScheduledStartTime(val);
                                                                setTimeInputValue(formatTo12Hour(val));
                                                            }}
                                                        />
                                                    </Popover>
                                                </InlineGrid>
                                                {!isStartTimeValid() && (
                                                    <Box paddingBlockStart="200">
                                                        <InlineStack gap="200" align="start">
                                                            <Icon source={AlertCircleIcon} tone="critical" />
                                                            <Text as="span" tone="critical">
                                                                Scheduled datetime must be in the future
                                                            </Text>
                                                        </InlineStack>
                                                    </Box>
                                                )}
                                            </BlockStack>
                                        </Box>
                                    )}
                                </BlockStack>
                            </Card>

                            <Card>
                                <BlockStack gap="200">
                                    <Checkbox
                                        label="Schedule the revert"
                                        checked={scheduleRevert}
                                        onChange={setScheduleRevert}
                                    />
                                    {scheduleRevert && (
                                        <Box paddingBlockStart="200">
                                            <InlineGrid columns={2} gap="400">
                                                <Popover
                                                    active={revertPopoverActive}
                                                    activator={
                                                        <TextField
                                                            label="Date"
                                                            value={formatDate(scheduledRevertDate.start)}
                                                            onFocus={toggleRevertPopoverActive}
                                                            autoComplete="off"
                                                            suffix={<Icon source={CalendarIcon} />}
                                                        />
                                                    }
                                                    onClose={toggleRevertPopoverActive}
                                                >
                                                    <Box padding="400">
                                                        <DatePicker
                                                            month={month}
                                                            year={year}
                                                            onChange={(range) => {
                                                                setScheduledRevertDate(range);
                                                                toggleRevertPopoverActive();
                                                            }}
                                                            onMonthChange={(m, y) => setDate({ month: m, year: y })}
                                                            selected={scheduledRevertDate}
                                                        />
                                                    </Box>
                                                </Popover>
                                                <Popover
                                                    active={revertTimePopoverActive}
                                                    activator={
                                                        <div onClick={toggleRevertTimePopoverActive} className={revertTimePopoverActive ? "time-picker-active" : ""}>
                                                            <TextField
                                                                label="Time"
                                                                value={revertTimeInputValue}
                                                                autoComplete="off"
                                                                suffix={<Icon source={ClockIcon} />}
                                                                readonly
                                                            />
                                                        </div>
                                                    }
                                                    onClose={toggleRevertTimePopoverActive}
                                                    preferredAlignment="left"
                                                >
                                                    <TimePickerContent
                                                        value={scheduledRevertTime}
                                                        onChange={(val: string) => {
                                                            setScheduledRevertTime(val);
                                                            setRevertTimeInputValue(formatTo12Hour(val));
                                                        }}
                                                    />
                                                </Popover>
                                            </InlineGrid>
                                            {!isRevertTimeValid() && (
                                                <Box paddingBlockStart="200">
                                                    <InlineStack gap="200" align="start">
                                                        <Icon source={AlertCircleIcon} tone="critical" />
                                                        <Text as="span" tone="critical">
                                                            Revert datetime must be at least 5 minutes greater than start datetime
                                                        </Text>
                                                    </InlineStack>
                                                </Box>
                                            )}
                                        </Box>
                                    )}
                                </BlockStack>
                                {shop?.ianaTimezone && (
                                    <Box paddingBlockStart="400">
                                        <Divider />
                                        <Box paddingBlockStart="400">
                                            <Text as="p" variant="bodyMd" tone="subdued">
                                                Timezone: <strong>{formatTimezone(shop.ianaTimezone)}</strong>. <Button variant="plain" onClick={() => navigate("/app/settings")}>Change timezone</Button>
                                            </Text>
                                        </Box>
                                    </Box>
                                )}
                            </Card>

                            {fieldToEdit !== 'tags' && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Tags manager</Text>
                                        <BlockStack gap="200">
                                            <Checkbox
                                                label="Add tags to products"
                                                checked={addTags}
                                                onChange={setAddTags}
                                            />
                                            {addTags && (
                                                <Box paddingBlockStart="200" paddingInlineStart="600">
                                                    <MultiTagSelect
                                                        selectedTags={tagsToAdd}
                                                        onChange={setTagsToAdd}
                                                        availableTags={productTags}
                                                        placeholder="Search or type to add tags"
                                                    />
                                                </Box>
                                            )}
                                            <Checkbox
                                                label="Remove tags from products"
                                                checked={removeTags}
                                                onChange={setRemoveTags}
                                            />
                                            {removeTags && (
                                                <Box paddingBlockStart="200" paddingInlineStart="600">
                                                    <MultiTagSelect
                                                        selectedTags={tagsToRemove}
                                                        onChange={setTagsToRemove}
                                                        availableTags={productTags}
                                                        placeholder="Search or type to remove tags"
                                                    />
                                                </Box>
                                            )}
                                            <Box paddingBlockStart="200" paddingInlineStart="0">
                                                <Text as="p" variant="bodyMd" tone="subdued">
                                                    Tags will be automatically removed when the task is undone
                                                </Text>
                                            </Box>
                                        </BlockStack>
                                    </BlockStack>
                                </Card>
                            )}
                        </BlockStack>
                    </div>
                    <div
                        className={`sticky-side-panel ${isPreviewCollapsed ? 'sticky-panel-collapsed' : 'sticky-panel-expanded'}`}
                        style={{
                            flex: isPreviewCollapsed ? '0 0 48px' : '1',
                            minWidth: isPreviewCollapsed ? '48px' : '0',
                            position: 'sticky',
                            top: '72px',
                            maxHeight: '800px',
                            overflowY: 'auto',
                            overflowX: isPreviewCollapsed ? 'hidden' : 'auto',
                            borderRadius: '16px',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        {isPreviewCollapsed ? (
                            <div
                                className="collapsed-panel-trigger"
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '24px',
                                    paddingTop: '20px',
                                    height: '100%',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setIsPreviewCollapsed(false)}
                                title="Expand Preview"
                            >
                                <Box padding="100">
                                    <Icon source={ChevronLeftIcon} tone="subdued" />
                                </Box>
                                <div className="collapsed-panel-text">
                                    Live Preview
                                </div>
                            </div>
                        ) : (
                            <BlockStack gap="200">
                                <Box padding="100" background="bg-surface-secondary" borderRadius="200">
                                    <InlineStack align="end" blockAlign="center">
                                        <Button
                                            icon={ChevronRightIcon}
                                            onClick={() => setIsPreviewCollapsed(true)}
                                            variant="tertiary"
                                            size="slim"
                                        >
                                            Collapse
                                        </Button>
                                    </InlineStack>
                                </Box>
                                <Banner
                                    title={demoProduct ? "Demo product created" : "Try a demo run first"}
                                    tone={demoProduct ? "success" : "info"}
                                >
                                    <BlockStack gap="200">
                                        <p>
                                            {demoProduct
                                                ? "The demo product has been selected in the preview below. You can apply edits to see how they affect this product."
                                                : "We'll create a demo product so you can review the results before updating real products."}
                                        </p>

                                        {demoProduct ? (
                                            <Button
                                                onClick={() => {
                                                    const id = demoProduct.id.split("/").pop();
                                                    window.open(`shopify:admin/products/${id}`, '_blank');
                                                }}
                                            >
                                                Open demo product in Shopify Admin
                                            </Button>
                                        ) : (
                                            <demoFetcher.Form method="post">
                                                <input type="hidden" name="intent" value="create-demo-product" />
                                                <Button submit loading={demoFetcher.state === "submitting"}>Create product</Button>
                                            </demoFetcher.Form>
                                        )}
                                    </BlockStack>
                                </Banner>
                                {true && (
                                    <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                        <Box padding="300">
                                            <BlockStack gap="200">
                                                <InlineStack align="space-between" blockAlign="center">
                                                    <Text variant="headingMd" as="h2">Preview</Text>
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <Text as="span" variant="bodyMd">Market:</Text>
                                                        <div style={{ minWidth: '200px' }}>
                                                            <Select
                                                                label="Market preview"
                                                                labelHidden
                                                                options={[
                                                                    ...(applyToMarkets && !applyToBasePrice ? [] : [{ label: "Base price", value: "base" }]),
                                                                    ...selectedMarkets.map(mHandle => {
                                                                        const market = markets.find((m: any) => m.handle === mHandle);
                                                                        return {
                                                                            label: market ? market.name : mHandle,
                                                                            value: mHandle
                                                                        };
                                                                    })
                                                                ]}
                                                                value={selectedPreviewMarket}
                                                                onChange={setSelectedPreviewMarket}
                                                            />
                                                        </div>
                                                    </InlineStack>
                                                </InlineStack>
                                                <InlineStack align="end">
                                                    <Button variant="plain" onClick={() => refreshPreview()} loading={fetcher.state === "submitting"}>Refresh preview</Button>
                                                </InlineStack>
                                            </BlockStack>
                                        </Box>
                                        <Divider />
                                        <div style={{ maxHeight: '600px', overflowY: 'auto', position: 'relative' }}>
                                            <PreviewTable
                                                market={selectedPreviewMarket}
                                                markets={markets}
                                                products={fetcher.data?.products || []}
                                                fieldToEdit={fieldToEdit}
                                                editMethod={editMethod}
                                                editValue={editValue}
                                                currency={currencySymbol}
                                                compareAtPriceOption={compareAtPriceOption}
                                                compareAtEditMethod={compareAtEditMethod}
                                                compareAtEditValue={compareAtEditValue}
                                                priceOption={priceOption}
                                                priceEditMethod={priceEditMethod}
                                                priceEditValue={priceEditValue}
                                                rounding={rounding}
                                                roundingValue={roundingValue}
                                                metafieldType={metafieldType}
                                                metafieldTargetType={metafieldTargetType}
                                                metafieldNamespace={metafieldNamespace}
                                                metafieldKey={metafieldKey}
                                                calculateUpdatedMetafieldValue={calculateUpdatedMetafieldValue}
                                                weightUnit={weightUnit}
                                                findText={findText}
                                                replaceText={replaceText}
                                                isLoading={fetcher.state !== 'idle'}
                                                addTags={addTags}
                                                tagsToAdd={tagsToAdd}
                                                removeTags={removeTags}
                                                tagsToRemove={tagsToRemove}
                                                rows={rows}
                                            />
                                        </div>
                                        <Box padding="400">
                                            <InlineStack align="center">
                                                <InlineStack align="center">
                                                    <Pagination
                                                        hasPrevious={fetcher.data?.pageInfo?.hasPreviousPage}
                                                        onPrevious={() => refreshPreview(fetcher.data?.pageInfo?.startCursor, 'prev')}
                                                        hasNext={fetcher.data?.pageInfo?.hasNextPage}
                                                        onNext={() => refreshPreview(fetcher.data?.pageInfo?.endCursor, 'next')}
                                                    />
                                                </InlineStack>
                                            </InlineStack>
                                        </Box>
                                    </div>
                                )}
                            </BlockStack>
                        )}
                    </div>
                </div >
            </BlockStack >

            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Task confirmation"
                primaryAction={{
                    content: "Save",
                    onAction: handleCreateTask,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => setIsModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    {(() => {
                        const { edits, scheduling, applications } = getTaskDescription();

                        // Consolidated list of details for the modal
                        const taskDetails = [...edits];

                        // Add scheduling if not immediate
                        if (startTime !== 'now') {
                            taskDetails.push(...scheduling);
                        }

                        // Add application scope
                        if (applyToProducts === 'all') {
                            taskDetails.push(`Applies to all products (${productsCount} products)`);
                        } else if (applyToProducts === 'collections') {
                            taskDetails.push(`Applies to ${selectedCollections.length} collections`);
                        } else if (applyToProducts === 'specific') {
                            taskDetails.push(`Applies to ${selectedProducts.length} specific products`);
                        } else if (applyToProducts === 'conditions') {
                            taskDetails.push(`Applies to products matching conditions`);
                        }

                        // Add variant scope if not all
                        if (applyToVariants !== 'all') {
                            taskDetails.push("Only applies to specific variants matching conditions");
                        }

                        // Add other filters
                        taskDetails.push(...applications);

                        return (
                            <BlockStack gap="400">
                                <Banner tone="warning">
                                    <Text as="p" variant="bodyMd">
                                        This task will update product data directly on Shopify. Please review all settings and preview the changes carefully before running.
                                    </Text>
                                </Banner>

                                <BlockStack gap="200">
                                    <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
                                        {taskDetails.map((desc, i) => (
                                            <li key={i}>
                                                <Text as="span" variant="bodyMd">{desc}</Text>
                                            </li>
                                        ))}
                                    </ul>
                                </BlockStack>

                                <Box paddingBlockStart="200">
                                    <BlockStack gap="200">
                                        <Text as="p" variant="bodyMd" fontWeight="bold">Important</Text>
                                        <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
                                            <li>
                                                <Text as="span" variant="bodyMd">Ensure that the preview reflects the correct changes</Text>
                                            </li>
                                            <li>
                                                <Text as="span" variant="bodyMd">Avoid making any manual product updates while the task is running</Text>
                                            </li>
                                            <li>
                                                <Text as="span" variant="bodyMd">If the task does not execute correctly, please contact us before reverting any changes</Text>
                                            </li>
                                        </ul>
                                    </BlockStack>
                                </Box>
                            </BlockStack>
                        );
                    })()}
                </Modal.Section>
            </Modal>
            {/* Save Preset Modal */}
            <Modal
                open={isPresetModalOpen}
                onClose={() => setIsPresetModalOpen(false)}
                title="Save Metafield Preset"
                primaryAction={{
                    content: 'Save',
                    onAction: () => {
                        const formData = new FormData();
                        formData.append("intent", "save-metafield-preset");
                        formData.append("presetName", presetName);
                        formData.append("namespace", metafieldNamespace);
                        formData.append("key", metafieldKey);
                        formData.append("type", metafieldType);
                        formData.append("target", metafieldTargetType);
                        savePresetFetcher.submit(formData, { method: "POST" });
                    },
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: () => setIsPresetModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <TextField
                        label="Preset Name"
                        value={presetName}
                        onChange={setPresetName}
                        autoComplete="off"
                        placeholder="e.g. Wash Care"
                    />
                </Modal.Section>
            </Modal>
        </Page >
    );
}


function PreviewTable({
    market,
    markets,
    products,
    fieldToEdit,
    editMethod,
    editValue,
    currency,
    compareAtPriceOption,
    compareAtEditMethod,
    compareAtEditValue,
    priceOption,
    priceEditMethod,
    priceEditValue,
    rounding,
    roundingValue,
    metafieldType,
    metafieldTargetType,
    metafieldNamespace,
    metafieldKey,
    calculateUpdatedMetafieldValue,
    weightUnit,
    findText,
    replaceText,
    isLoading,
    addTags,
    tagsToAdd,
    removeTags,
    tagsToRemove,
    rows
}: {
    market: string,
    markets: any[],
    products: any[],
    rounding: string,
    roundingValue: string,
    fieldToEdit: string,
    editMethod: string,
    editValue: string,
    currency: string,
    compareAtPriceOption: string,
    compareAtEditMethod: string,
    compareAtEditValue: string,
    priceOption: string,
    priceEditMethod: string,
    priceEditValue: string,
    metafieldType: string,
    metafieldTargetType: string,
    metafieldNamespace: string,
    metafieldKey: string,
    calculateUpdatedMetafieldValue: (args: any) => string,
    weightUnit?: string,
    findText?: string,
    replaceText?: string,
    isLoading?: boolean,
    addTags?: boolean,
    tagsToAdd?: string[],
    removeTags?: boolean,
    tagsToRemove?: string[],
    rows: any[]
}) {
    // Dynamic Columns Configuration (RESTORED)
    let columns: any[] = [
        { title: "Image" },
        { title: "Product" },
        { title: "Original" },
        { title: "Updated" }
    ];

    if (fieldToEdit === 'price') {
        const showCompareAsBase = ['set_to_compare_at', 'percentage_of_compare_at'].includes(editMethod);
        const showCostAsBase = ['set_to_cost', 'percentage_of_cost'].includes(editMethod);
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: (market === 'base' || market === 'empty') ? "Original Price" : `Original Price (${markets.find((m: any) => m.handle === market)?.name || market})` },
            { title: "New Price" },
        ];
        if (compareAtPriceOption !== 'none' || showCompareAsBase) {
            columns.push({ title: "Original Compare Price" });
            columns.push({ title: "New Compare Price" });
        }
        if (showCostAsBase) {
            columns.push({ title: "Original Cost" });
        }
    } else if (fieldToEdit === 'compare_price') {
        const showPriceAsBase = ['set_to_price'].includes(editMethod);
        const showCostAsBase = ['set_to_cost', 'percentage_of_cost'].includes(editMethod);
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Original Compare Price" },
            { title: "New Compare Price" },
        ];
        if (priceOption !== 'none' || showPriceAsBase) {
            columns.push({ title: "Original Price" });
            columns.push({ title: "New Price" });
        }
        if (showCostAsBase) {
            columns.push({ title: "Original Cost" });
        }
    } else if (fieldToEdit === 'metafield') {
        columns = [
            { title: "Image" },
            { title: metafieldTargetType === 'product' ? "Product" : "Variant" },
            { title: "Original Metafield" },
            { title: "Updated Metafield" }
        ];
    } else if (fieldToEdit === 'inventory') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Current Inventory" },
            { title: "New Inventory" }
        ];
    } else if (fieldToEdit === 'cost') {
        const showPriceAsBase = ['set_to_price'].includes(editMethod);
        const showCompareAsBase = ['set_to_compare_at'].includes(editMethod);
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Original Cost" },
            { title: "New Cost" }
        ];
        if (showPriceAsBase) columns.splice(2, 0, { title: "Original Price" });
        if (showCompareAsBase) columns.splice(2, 0, { title: "Original Compare Price" });
    } else if (fieldToEdit === 'status') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Current Status" },
            { title: "New Status" }
        ];
    } else if (fieldToEdit === 'weight') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Current Weight" },
            { title: "New Weight" }
        ];
    } else if (fieldToEdit === 'vendor') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Current Vendor" },
            { title: "New Vendor" }
        ];
    } else if (fieldToEdit === 'product_type') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Current Type" },
            { title: "New Type" }
        ];
    } else if (fieldToEdit === 'requires_shipping') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Requires Shipping" },
            { title: "Updated Setting" }
        ];
    } else if (fieldToEdit === 'taxable') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Is Taxable" },
            { title: "Updated Setting" }
        ];
    } else if (fieldToEdit === 'tags') {
        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: "Original Tags" },
            { title: "Updated Tags" }
        ];
    } else if (fieldToEdit !== 'tags') {
        const fieldLabel = ({
            vendor: "Vendor",
            product_type: "Product Type",
            requires_shipping: "Requires Shipping",
            taxable: "Taxable",
            title: "Title",
            body_html: "Body HTML",
            handle: "Handle",
            template_suffix: "Template Suffix",
            published: "Published Status",
            inventory_policy: "Inventory Policy",
            sku: "SKU",
            barcode: "Barcode",
            seo_title: "SEO Title",
            seo_description: "SEO Description",
            google_product_category: "Google: Product Category",
            google_custom_label_0: "Google: Custom Label 0",
            google_custom_label_1: "Google: Custom Label 1",
            google_custom_label_2: "Google: Custom Label 2",
            google_custom_label_3: "Google: Custom Label 3",
            google_custom_label_4: "Google: Custom Label 4"
        } as any)[fieldToEdit] || fieldToEdit;

        columns = [
            { title: "Image" },
            { title: "Product" },
            { title: `Original ${fieldLabel}` },
            { title: `New ${fieldLabel}` }
        ];
    }
    const showSidebarTags = (addTags && (tagsToAdd || []).length > 0) || (removeTags && (tagsToRemove || []).length > 0);
    if (showSidebarTags && fieldToEdit !== 'tags') {
        columns.push({ title: "Tags (Original)" });
        columns.push({ title: "Tags (Updated)" });
    }

    // Add dynamic tag columns if any row has tagsUpdated (secondary tag actions)
    const hasSecondaryTags = useMemo(() => {
        return products.some((p: any) => p.tagsUpdated !== undefined);
    }, [products]);


    return (
        <div style={{ position: 'relative' }}>
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(2px)',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--p-border-radius-200)'
                }}>
                    <Spinner size="large" />
                </div>
            )}
            <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={rows.length}
                headings={columns as any}
                selectable={false}
            >
                {rows.map((row, index) => (
                    <IndexTable.Row id={row.id} key={`${row.id}-${index}`} position={index}>
                        <IndexTable.Cell>
                            {row.image ? (
                                <div style={{ width: 50, height: 50 }}>
                                    <img src={row.image} alt={row.product} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                            ) : null}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <Text variant="bodyMd" as="span" fontWeight={row.isParent ? 'bold' : 'regular'}>
                                {row.isVariant ? (
                                    <div style={{ paddingLeft: '20px' }}>{row.product}</div>
                                ) : row.product}
                            </Text>
                        </IndexTable.Cell>
                        {/* Render dynamic columns based on fieldToEdit */}
                        {fieldToEdit === 'price' ? (
                            <>
                                <IndexTable.Cell>
                                    <span style={{ textDecoration: 'line-through', color: 'var(--p-color-text-subdued)' }}>
                                        {row.originalPrice ? `${currency}${row.originalPrice}` : ''}
                                    </span>
                                </IndexTable.Cell>
                                <IndexTable.Cell>{row.updatePrice ? `${currency}${row.updatePrice}` : ''}</IndexTable.Cell>
                                {(compareAtPriceOption !== 'none' || ['set_to_compare_at', 'percentage_of_compare_at'].includes(editMethod)) && (
                                    <>
                                        <IndexTable.Cell>
                                            <span style={{ textDecoration: compareAtPriceOption !== 'none' ? 'line-through' : 'none', color: compareAtPriceOption !== 'none' ? 'var(--p-color-text-subdued)' : 'inherit' }}>
                                                {row.originalComparePrice ? `${currency}${row.originalComparePrice}` : ''}
                                            </span>
                                        </IndexTable.Cell>
                                        <IndexTable.Cell>{row.updateComparePrice ? `${currency}${row.updateComparePrice}` : ''}</IndexTable.Cell>
                                    </>
                                )}
                                {['set_to_cost', 'percentage_of_cost'].includes(editMethod) && (
                                    <IndexTable.Cell>
                                        <Text variant="bodyMd" as="span">{row.originalCost ? `${currency}${row.originalCost}` : ''}</Text>
                                    </IndexTable.Cell>
                                )}
                            </>
                        ) : fieldToEdit === 'compare_price' ? (
                            <>
                                <IndexTable.Cell>
                                    <span style={{ textDecoration: 'line-through', color: 'var(--p-color-text-subdued)' }}>
                                        {row.originalComparePrice ? `${currency}${row.originalComparePrice}` : ''}
                                    </span>
                                </IndexTable.Cell>
                                <IndexTable.Cell>{row.updateComparePrice ? `${currency}${row.updateComparePrice}` : ''}</IndexTable.Cell>
                                {(priceOption !== 'none' || ['set_to_price'].includes(editMethod)) && (
                                    <>
                                        <IndexTable.Cell>
                                            <span style={{ textDecoration: priceOption !== 'none' ? 'line-through' : 'none', color: priceOption !== 'none' ? 'var(--p-color-text-subdued)' : 'inherit' }}>
                                                {row.originalPrice ? `${currency}${row.originalPrice}` : ''}
                                            </span>
                                        </IndexTable.Cell>
                                        <IndexTable.Cell>{row.updatePrice ? `${currency}${row.updatePrice}` : ''}</IndexTable.Cell>
                                    </>
                                )}
                                {['set_to_cost', 'percentage_of_cost'].includes(editMethod) && (
                                    <IndexTable.Cell>
                                        <Text variant="bodyMd" as="span">{row.originalCost ? `${currency}${row.originalCost}` : ''}</Text>
                                    </IndexTable.Cell>
                                )}
                            </>
                        ) : (fieldToEdit as string) === 'cost' ? (
                            <>
                                {editMethod === 'set_to_price' && (
                                    <IndexTable.Cell>
                                        <Text variant="bodyMd" as="span">{row.originalPrice ? `${currency}${row.originalPrice}` : ''}</Text>
                                    </IndexTable.Cell>
                                )}
                                {editMethod === 'set_to_compare_at' && (
                                    <IndexTable.Cell>
                                        <span style={{ color: 'var(--p-color-text-subdued)' }}>
                                            {row.originalComparePrice ? `${currency}${row.originalComparePrice}` : ''}
                                        </span>
                                    </IndexTable.Cell>
                                )}
                                <IndexTable.Cell>
                                    <span style={{ textDecoration: editMethod !== 'fixed' && !['set_to_price', 'set_to_compare_at'].includes(editMethod) ? 'line-through' : 'none', color: editMethod !== 'fixed' && !['set_to_price', 'set_to_compare_at'].includes(editMethod) ? 'var(--p-color-text-subdued)' : 'inherit' }}>
                                        {row.originalVal ? `${currency}${row.originalVal}` : ''}
                                    </span>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                        {row.updateVal ? `${currency}${row.updateVal}` : ''}
                                    </Text>
                                </IndexTable.Cell>
                            </>
                        ) : (fieldToEdit as string) === 'inventory' || (fieldToEdit as string) === 'weight' ? (
                            <>
                                <IndexTable.Cell>
                                    <span style={{ textDecoration: editMethod !== 'fixed' ? 'line-through' : 'none', color: editMethod !== 'fixed' ? 'var(--p-color-text-subdued)' : 'inherit' }}>
                                        {row.originalVal}
                                    </span>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                        {row.updateVal}
                                    </Text>
                                </IndexTable.Cell>
                            </>
                        ) : (fieldToEdit as string) === 'tags' ? (
                            <>
                                <IndexTable.Cell>
                                    <div style={{ minWidth: '150px', maxWidth: '300px' }}>
                                        <InlineStack gap="100" wrap={true}>
                                            {(row.originalVal || "").split(",").filter(Boolean).map((t: string, i: number) => (
                                                <Badge key={i}>{t.trim()}</Badge>
                                            ))}
                                        </InlineStack>
                                    </div>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <div style={{ minWidth: '150px', maxWidth: '300px' }}>
                                        <InlineStack gap="100" wrap={true}>
                                            {(row.updateVal || "").split(",").filter(Boolean).map((t: string, i: number) => (
                                                <Badge key={i} tone="success">{t.trim()}</Badge>
                                            ))}
                                        </InlineStack>
                                    </div>
                                </IndexTable.Cell>
                            </>

                        ) : (
                            <>
                                {(() => {
                                    const formatVal = (val: any) => {
                                        if (val === undefined || val === null || val === "") return "(empty)";
                                        if (fieldToEdit === 'published') return String(val).toLowerCase() === 'true' ? 'Visible' : 'Hidden';
                                        if (fieldToEdit === 'inventory_policy') return String(val).toUpperCase() === 'CONTINUE' ? 'Continue' : 'Deny';
                                        if (fieldToEdit === 'requires_shipping' || fieldToEdit === 'taxable') return String(val).toLowerCase() === 'true' || val === true ? 'Yes' : 'No';
                                        return String(val);
                                    };
                                    return (
                                        <>
                                            <IndexTable.Cell><Text variant="bodyMd" as="span">{formatVal(row.originalVal)}</Text></IndexTable.Cell>
                                            <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{formatVal(row.updateVal)}</Text></IndexTable.Cell>
                                        </>
                                    );
                                })()}
                            </>
                        )}

                        {showSidebarTags && fieldToEdit !== 'tags' && (
                            <>
                                <IndexTable.Cell>
                                    <div style={{ minWidth: '150px', maxWidth: '300px' }}>
                                        <InlineStack gap="100" wrap={true}>
                                            {(row.tagsOriginal || "").split(",").filter(Boolean).map((t: string, i: number) => (
                                                <Badge key={i}>{t.trim()}</Badge>
                                            ))}
                                        </InlineStack>
                                    </div>
                                </IndexTable.Cell>
                                <IndexTable.Cell>
                                    <div style={{ minWidth: '150px', maxWidth: '300px' }}>
                                        <InlineStack gap="100" wrap={true}>
                                            {(row.tagsUpdated || "").split(",").filter(Boolean).map((t: string, i: number) => (
                                                <Badge key={i} tone="success">{t.trim()}</Badge>
                                            ))}
                                        </InlineStack>
                                    </div>
                                </IndexTable.Cell>
                            </>
                        )}

                        {/* Additional Tag Columns if they exist as secondary action */}
                        {/* Secondary Tag Columns REMOVED (Moved to Sidebar) */}
                    </IndexTable.Row>
                ))}
                {rows.length === 0 && (
                    <IndexTable.Row id="empty" position={0}>
                        <IndexTable.Cell>
                            <Text tone="subdued" as="span">{market === 'empty' ? "Please select a market to view preview." : "Select products to see preview..."}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span"> </Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span"> </Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span"> </Text></IndexTable.Cell>
                    </IndexTable.Row>
                )}
            </IndexTable>
        </div>
    );
}

function TagConditionInput({ value, onChange, availableTags }: { value: string, onChange: (val: string) => void, availableTags: string[] }) {
    const [inputValue, setInputValue] = useState(value);
    const [options, setOptions] = useState(availableTags || []);
    const [active, setActive] = useState(false);

    useEffect(() => {
        setInputValue(value);
    }, [value]);

    useEffect(() => {
        console.log("DEBUG TagConditionInput availableTags:", availableTags);
        setOptions(availableTags || []);
    }, [availableTags]);

    const updateText = useCallback(
        (newValue: string) => {
            setInputValue(newValue);
            onChange(newValue);
            setActive(true);

            if (newValue === "") {
                setOptions(availableTags || []);
                return;
            }

            const filterRegex = new RegExp(newValue, 'i');
            const resultOptions = (availableTags || []).filter((option) =>
                option.match(filterRegex),
            );
            setOptions(resultOptions);
        },
        [availableTags, onChange],
    );

    const updateSelection = useCallback(
        (selectedValue: string) => {
            setInputValue(selectedValue);
            onChange(selectedValue);
            setActive(false);
        },
        [onChange],
    );

    const activator = (
        <div onFocus={() => setActive(true)}>
            <TextField
                onChange={updateText}
                label="Tag"
                labelHidden
                value={inputValue}
                placeholder="Search tags"
                autoComplete="off"
                onFocus={() => {
                    console.log("TagInput Focus. Tags count:", (availableTags || []).length);
                    if (inputValue === "") {
                        setOptions(availableTags || []);
                    } else {
                        const filterRegex = new RegExp(inputValue, 'i');
                        const resultOptions = (availableTags || []).filter((option) =>
                            option.match(filterRegex),
                        );
                        setOptions(resultOptions);
                    }
                    setActive(true);
                }}
            />
        </div>
    );

    return (
        <Popover
            active={active}
            activator={activator}
            onClose={() => setActive(false)}
            autofocusTarget="none"
            fullWidth
            preferredAlignment="left"
        >
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                <ActionList
                    actionRole="menuitem"
                    items={options.length > 0 ? options.map((tag) => ({
                        content: tag,
                        onAction: () => updateSelection(tag),
                    })) : [{ content: "No tags found", disabled: true }]}
                />
            </div>
        </Popover>
    );
}

function MultiTagSelect({ selectedTags, onChange, availableTags, placeholder }: { selectedTags: string[], onChange: (tags: string[]) => void, availableTags: string[], placeholder: string }) {
    const [inputValue, setInputValue] = useState("");
    const [options, setOptions] = useState(availableTags || []);

    // Initial load options
    useEffect(() => {
        setOptions(availableTags || []);
    }, [availableTags]);

    const updateText = useCallback(
        (value: string) => {
            setInputValue(value);

            if (value === "") {
                setOptions(availableTags || []);
                return;
            }

            const filterRegex = new RegExp(value, 'i');
            const resultOptions = (availableTags || []).filter((option) =>
                option.match(filterRegex),
            );
            setOptions(resultOptions);
        },
        [availableTags],
    );

    const updateSelection = useCallback(
        (selected: string[]) => {
            const selectedValue = selected[0];
            if (!selectedValue) return;

            // Handle "ADD_NEW_TAG" special value
            if (selectedValue.startsWith("ADD_NEW_TAG:")) {
                const newTag = selectedValue.replace("ADD_NEW_TAG:", "").trim();
                if (newTag && !selectedTags.includes(newTag)) {
                    onChange([...selectedTags, newTag]);
                }
            } else if (!selectedTags.includes(selectedValue)) {
                onChange([...selectedTags, selectedValue]);
            }
            setInputValue("");
            setOptions(availableTags || []); // Reset options
        },
        [selectedTags, onChange, availableTags],
    );

    // Allow adding custom tags (not in list) on Enter
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = inputValue.trim();
            if (val && !selectedTags.includes(val)) {
                onChange([...selectedTags, val]);
                setInputValue("");
            }
        }
    };

    const removeTag = (tag: string) => {
        onChange(selectedTags.filter((t) => t !== tag));
    };

    // Calculate options including the "Add" suggestion
    const autocompleteOptions = useMemo(() => {
        const filtered = options.map((tag) => ({ value: tag, label: tag }));
        const currentTrimmed = inputValue.trim();

        // Add "Add [tag]" option if there is an input and it is not already in the precise options
        if (currentTrimmed && !options.some(o => o.toLowerCase() === currentTrimmed.toLowerCase())) {
            filtered.unshift({
                value: `ADD_NEW_TAG:${currentTrimmed}`,
                label: `Add ${currentTrimmed}` as any // We override label in renderOption if Autocomplete supports it, or use value
            });
        }
        return filtered;
    }, [options, inputValue]);

    return (
        <BlockStack gap="200">
            <div onKeyDown={handleKeyDown}>
                <Autocomplete
                    options={autocompleteOptions}
                    selected={[]}
                    onSelect={updateSelection}
                    textField={
                        <Autocomplete.TextField
                            onChange={updateText}
                            label="Tags"
                            labelHidden
                            value={inputValue}
                            placeholder={placeholder}
                            autoComplete="off"
                        />
                    }
                    listTitle="Suggestions"
                />
            </div>
            {/* Custom rendering for the "Add" suggestion using a decorative element if we can't easily hook into Autocomplete internal render */}
            {inputValue && !options.some(o => o.toLowerCase() === inputValue.trim().toLowerCase()) && (
                <Box paddingInlineStart="100" paddingInlineEnd="100" paddingBlockStart="100">
                    <div
                        onClick={() => updateSelection([`ADD_NEW_TAG:${inputValue.trim()}`])}
                        style={{
                            cursor: 'pointer',
                            padding: '12px 16px',
                            background: '#f1f1f1',
                            borderRadius: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            border: '1px solid #e1e1e1',
                            transition: 'background 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = '#e8e8e8'}
                        onMouseOut={(e) => e.currentTarget.style.background = '#f1f1f1'}
                    >
                        <div style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            border: '1px solid #c1c1c1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <Icon source={PlusIcon} tone="base" />
                        </div>
                        <Text variant="bodyMd" as="span" fontWeight="bold">Add {inputValue.trim()}</Text>
                    </div>
                </Box>
            )}

            {selectedTags.length > 0 && (
                <InlineStack gap="200">
                    {selectedTags.map((tag) => (
                        <Tag key={tag} onRemove={() => removeTag(tag)}>
                            {tag}
                        </Tag>
                    ))}
                </InlineStack>
            )}
        </BlockStack>
    );
}

export const headers = (headersArgs: any) => {
    return boundary.headers(headersArgs);
};
