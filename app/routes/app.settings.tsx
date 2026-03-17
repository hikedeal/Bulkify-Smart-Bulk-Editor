import {
    Box,
    Card,
    Layout,
    Page,
    Text,
    BlockStack,
    TextField,
    Button,
    InlineStack,
    Divider,
    Select,
    Autocomplete,
    Checkbox,
    Icon,
} from "@shopify/polaris";
import { SearchIcon, SettingsIcon, NotificationIcon, ChatIcon, CashDollarIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    // 1. Fetch data from DB in parallel
    const [settings, dbShop] = await Promise.all([
        prisma.shopSettings.findUnique({ where: { shopDomain: shop } }),
        prisma.shop.findUnique({ where: { shop }, select: { plan: true } })
    ]);

    let finalSettings = settings;

    // 2. Only fetch from Shopify if settings are completely missing or critical fields are empty
    if (!settings || !settings.contactEmail) {
        console.log("Settings: Fetching fallback data from Shopify for", shop);
        const shopifyResponse = await admin.graphql(
            `#graphql
          query getShopDetails {
            shop {
              name
              email
              ianaTimezone
            }
          }`
        );
        const shopifyData = (await shopifyResponse.json()) as any;
        const shopDetails = shopifyData?.data?.shop;

        if (shopDetails) {
            finalSettings = await prisma.shopSettings.upsert({
                where: { shopDomain: shop },
                update: {
                    shopName: shopDetails.name,
                    contactEmail: shopDetails.email,
                    timezone: shopDetails.ianaTimezone || "UTC",
                    updatedAt: new Date()
                },
                create: {
                    shopDomain: shop,
                    shopName: shopDetails.name,
                    contactEmail: shopDetails.email,
                    timezone: shopDetails.ianaTimezone || "UTC"
                }
            });
        }
    }

    return {
        settings: {
            shop_name: finalSettings?.shopName || "",
            contact_email: finalSettings?.contactEmail || "",
            timezone: finalSettings?.timezone || "UTC"
        },
        currentPlan: dbShop?.plan || "FREE"
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();

    const shopName = formData.get("shopName") as string;
    const email = formData.get("email") as string;
    const timezone = formData.get("timezone") as string;

    try {
        await prisma.shopSettings.upsert({
            where: { shopDomain: shop },
            update: {
                shopName,
                contactEmail: email,
                timezone,
                updatedAt: new Date()
            },
            create: {
                shopDomain: shop,
                shopName,
                contactEmail: email,
                timezone
            }
        });
        return { success: true };
    } catch (error: any) {
        return { error: error.message };
    }
};

export default function SettingsPage() {
    const { settings, currentPlan } = useLoaderData();
    const actionData = useActionData();
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const isSaving = navigation.state === "submitting";

    const [shopName, setShopName] = useState(settings.shop_name || "");
    const [email, setEmail] = useState(settings.contact_email || "");
    const [timezone, setTimezone] = useState(settings.timezone || "UTC");

    // Mock notification states for UI demo (in real app, these would come from DB)
    const [emailAlerts, setEmailAlerts] = useState(true);
    const [failedTaskAlerts, setFailedTaskAlerts] = useState(true);

    // Helper to get GMT offset string
    const getGMTOffset = (tz: string) => {
        try {
            const date = new Date();
            const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
            const tzDate = new Date(date.toLocaleString("en-US", { timeZone: tz }));
            const offset = (tzDate.getTime() - utcDate.getTime()) / (60 * 60 * 1000);
            const hours = Math.floor(Math.abs(offset));
            const minutes = Math.round((Math.abs(offset) % 1) * 60);
            const prefix = offset >= 0 ? "+" : "-";
            return `(GMT${prefix}${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")})`;
        } catch (e) {
            return "(GMT+00:00)";
        }
    };

    // Mapping of legacy IANA city names to modern/preferred names for the UI
    const modernCityNames: { [key: string]: string } = {
        "Calcutta": "Kolkata",
        "Saigon": "Ho Chi Minh City",
        "Rangoon": "Yangon",
        "Peking": "Beijing",
        "Bombay": "Mumbai",
        "Madras": "Chennai",
    };

    // Helper to format label with modern names
    const formatLabel = useCallback((tz: string) => {
        const offset = getGMTOffset(tz);
        const parts = tz.split("/");
        const region = parts[0];
        let city = parts[1] ? parts[1].replace(/_/g, " ") : region;

        if (modernCityNames[city]) {
            city = modernCityNames[city];
        }

        const subCity = parts[2] ? ` - ${parts[2].replace(/_/g, " ")}` : "";
        return `${offset} ${region}: ${city}${subCity}`;
    }, []);

    const timezones = useMemo(() => Intl.supportedValuesOf("timeZone").map((tz) => ({
        label: formatLabel(tz),
        value: tz,
    })).sort((a, b) => a.label.localeCompare(b.label)), [formatLabel]);

    const [inputValue, setInputValue] = useState(formatLabel(timezone));
    const [options, setOptions] = useState(timezones);

    const updateText = useCallback(
        (value: string) => {
            setInputValue(value);

            if (value === "") {
                setOptions(timezones);
                return;
            }

            const lowerValue = value.toLowerCase();
            const searchTerms = [lowerValue];

            Object.entries(modernCityNames).forEach(([legacy, modern]) => {
                const lowerLegacy = legacy.toLowerCase();
                const lowerModern = modern.toLowerCase();
                if (lowerValue.includes(lowerModern)) {
                    searchTerms.push(lowerLegacy);
                }
                if (lowerValue.includes(lowerLegacy)) {
                    searchTerms.push(lowerModern);
                }
            });

            const resultOptions = timezones.filter((option) =>
                searchTerms.some(term => option.label.toLowerCase().includes(term))
            );
            setOptions(resultOptions);
        },
        [timezones, modernCityNames],
    );

    const updateSelection = useCallback(
        (selected: string[]) => {
            const selectedValue = selected[0];
            const selectedOption = timezones.find((option) => {
                return option.value.indexOf(selectedValue) >= 0;
            });

            setTimezone(selectedValue);
            setInputValue(selectedOption?.label || selectedValue);
        },
        [timezones],
    );

    const textField = (
        <Autocomplete.TextField
            onChange={updateText}
            label="Time Zone"
            value={inputValue}
            prefix={<Icon source={SearchIcon} />}
            placeholder="Search by city or region (e.g. Kolkata, New York)"
            autoComplete="off"
            helpText="Defaults to your Shopify store's time zone. Used for all scheduled tasks."
        />
    );

    useEffect(() => {
        if (actionData?.success) {
            window.shopify.toast.show("Settings saved successfully");
        } else if (actionData?.error) {
            window.shopify.toast.show(`Error: ${actionData.error}`, { isError: true });
        }
    }, [actionData]);

    const handleSave = () => {
        submit(
            { shopName, email, timezone },
            { method: "post" }
        );
    };

    return (
        <Page fullWidth>
            <BlockStack gap="800">
                {/* Header Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-10%', right: '-5%', width: '200px', height: '200px' }} />
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <BlockStack gap="200">
                            <Text as="h1" variant="heading2xl" fontWeight="bold">
                                Settings
                            </Text>
                            <Text as="p" variant="bodyLg">
                                <span style={{ opacity: 0.9 }}>Manage your store preferences and application configuration.</span>
                            </Text>
                        </BlockStack>
                        <Button
                            variant="primary"
                            size="large"
                            onClick={handleSave}
                            loading={isSaving}
                        >
                            Save changes
                        </Button>
                    </div>
                </div>

                <Layout>
                    <Layout.Section>
                        <BlockStack gap="500">
                            {/* General Settings */}
                            <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                <div style={{ padding: '24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#e0f2fe', padding: '8px', borderRadius: '8px' }}>
                                            <Icon source={SettingsIcon} tone="info" />
                                        </div>
                                        <BlockStack gap="050">
                                            <Text variant="headingMd" as="h2">General Configuration</Text>
                                            <Text variant="bodySm" as="p" tone="subdued">Basic store details and defaults</Text>
                                        </BlockStack>
                                    </InlineStack>
                                </div>
                                <div style={{ padding: '24px' }}>
                                    <BlockStack gap="400">
                                        <TextField
                                            label="Shop Name"
                                            value={shopName}
                                            onChange={setShopName}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Contact Email"
                                            type="email"
                                            value={email}
                                            onChange={setEmail}
                                            autoComplete="email"
                                            helpText="We'll use this for critical system alerts."
                                        />
                                        <Autocomplete
                                            options={options}
                                            selected={[timezone]}
                                            onSelect={updateSelection}
                                            textField={textField}
                                        />
                                    </BlockStack>
                                </div>
                            </div>

                            {/* Notification Settings */}
                            <div className="stat-card-static" style={{ overflow: 'hidden' }}>
                                <div style={{ padding: '24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#fef3c7', padding: '8px', borderRadius: '8px' }}>
                                            <Icon source={NotificationIcon} tone="warning" />
                                        </div>
                                        <BlockStack gap="050">
                                            <Text variant="headingMd" as="h2">Notifications</Text>
                                            <Text variant="bodySm" as="p" tone="subdued">Control when you receive email alerts</Text>
                                        </BlockStack>
                                    </InlineStack>
                                </div>
                                <div style={{ padding: '24px' }}>
                                    <BlockStack gap="400">
                                        <Checkbox
                                            label="Completed task summaries"
                                            checked={emailAlerts}
                                            onChange={setEmailAlerts}
                                            helpText="Receive a summary email when a bulk edit finishes."
                                        />
                                        <Checkbox
                                            label="Failed task alerts"
                                            checked={failedTaskAlerts}
                                            onChange={setFailedTaskAlerts}
                                            helpText="Get notified immediately if a scheduled task fails to run."
                                        />
                                        <Divider />
                                        <InlineStack align="start">
                                            <Button onClick={() => navigate("/app/email-preview")} variant="tertiary">Preview Email Templates</Button>
                                        </InlineStack>
                                    </BlockStack>
                                </div>
                            </div>

                        </BlockStack>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <BlockStack gap="500">
                            <div style={{ background: '#fff7ed', borderRadius: '16px', padding: '24px', border: '1px solid #ffedd5' }}>
                                <BlockStack gap="400">
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#ffedd5', padding: '8px', borderRadius: '8px' }}>
                                            <Icon source={ChatIcon} tone="warning" />
                                        </div>
                                        <Text variant="headingMd" as="h2">Need Help?</Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodyMd">
                                        Stuck on a configuration? Our support team is here to help you get the most out of Bulk Editor.
                                    </Text>
                                    <Button variant="plain" tone="critical" textAlign="left">Contact Support →</Button>
                                </BlockStack>
                            </div>
                        </BlockStack>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}

export const headers = (headersArgs: any) => {
    return boundary.headers(headersArgs);
};
