
import { Page, Card, Layout, BlockStack, Text, Button, InlineStack, Divider, Select, Banner } from "@shopify/polaris";
import { useState } from "react";
import { useSubmit, useActionData, useNavigation, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
    sendTaskCompletedEmail,
    sendTaskFailedEmail,
    sendTaskScheduledEmail,
    sendRevertScheduledEmail,
    sendRevertCompletedEmail
} from "../services/email.server";
import type { ActionFunctionArgs } from "react-router";

// Mock Data
const mockTask = {
    name: "Spring Sale Price Update",
    id: "JOB-TEST-123",
    productsCount: 1250,
    completedAt: new Date().toLocaleString(),
    error: "Rate limit exceeded. Please try again later.",
    shopName: "Hikedeal Store", // Fallback name
    duration: "2m 14s",
    description: "Increased price by 10% • Rounded to .99 • Added tags: \"Sale\"",
    editingRules: "Price (increase by percentage): 10%. Round to nearest .99 • Add tags: \"Sale\"",
    appliesTo: "1250 products selected",
    scheduledAt: "2/15/2026, 10:00:00 AM"
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const type = formData.get("type");
    const shop = session.shop;

    // Fetch email from DB
    let settingsValue: any = await prisma.shopSettings.findUnique({
        where: { shopDomain: shop }
    });

    if (!settingsValue?.contactEmail) {
        const response = await admin.graphql(`{ shop { email name } }`);
        const responseJson = await response.json();
        const shopData = responseJson.data?.shop;

        if (shopData?.email) {
            settingsValue = await prisma.shopSettings.upsert({
                where: { shopDomain: shop },
                update: {
                    shopName: shopData.name,
                    contactEmail: shopData.email,
                    updatedAt: new Date()
                },
                create: {
                    shopDomain: shop,
                    shopName: shopData.name,
                    contactEmail: shopData.email,
                    updatedAt: new Date()
                }
            });
        } else {
            return { error: "Could not retrieve an email address from Shopify. Please configure one in Settings." };
        }
    }

    const emailData = {
        taskName: mockTask.name,
        taskId: mockTask.id,
        productsCount: mockTask.productsCount,
        duration: mockTask.duration,
        completedAt: new Date().toLocaleString(),
        scheduledAt: mockTask.scheduledAt,
        error: mockTask.error,
        shopName: settingsValue.shopName || shop,
        shopDomain: shop,
        toEmail: settingsValue.contactEmail,
        description: mockTask.description,
        editingRules: mockTask.editingRules,
        appliesTo: mockTask.appliesTo
    };

    try {
        let response;
        if (type === 'failed') response = await sendTaskFailedEmail(emailData);
        else if (type === 'scheduled') response = await sendTaskScheduledEmail(emailData);
        else if (type === 'revert_scheduled') response = await sendRevertScheduledEmail(emailData);
        else if (type === 'revert_completed') response = await sendRevertCompletedEmail(emailData);
        else response = await sendTaskCompletedEmail(emailData);

        if (response?.error) {
            return { error: `Resend Error: ${response.error.message}` };
        }

        return { success: `Test email (${type}) sent to ${settingsValue.contactEmail}.` };
    } catch (e: any) {
        return { error: `Exception: ${e.message}` };
    }
};

export default function EmailPreview() {
    const [emailType, setEmailType] = useState('success');
    const [isMobile, setIsMobile] = useState(false);
    const submit = useSubmit();
    const navigate = useNavigate();
    const actionData = useActionData<{ success?: string; error?: string }>();
    const navigation = useNavigation();
    const isSending = navigation.state === "submitting";

    const styles: any = {
        viewportContainer: {
            backgroundColor: '#f1f5f9',
            padding: '40px 20px',
            display: 'flex',
            justifyContent: 'center',
            minHeight: '600px',
            transition: 'all 0.3s ease',
        },
        deviceWrapper: {
            width: isMobile ? '375px' : '100%',
            maxWidth: isMobile ? '375px' : '640px',
            margin: '0 auto',
            transition: 'all 0.3s ease',
            boxShadow: isMobile ? '0 0 0 12px #1e293b, 0 0 0 15px #334155, 0 20px 50px rgba(0,0,0,0.3)' : 'none',
            borderRadius: isMobile ? '40px' : '24px',
            overflow: 'hidden',
            backgroundColor: '#ffffff',
        },
        // Premium Design System (Matched with email.server.ts)
        wrapper: { backgroundColor: '#f1f5f9', padding: '60px 20px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', width: '100%', boxSizing: 'border-box' },
        container: { maxWidth: '540px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', border: '1px solid #e2e8f0', position: 'relative' as const },
        accentBar: (color: string) => ({ height: '6px', width: '100%', position: 'absolute' as const, top: 0, left: 0, backgroundColor: color }),
        header: { background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '50px 40px', textAlign: 'center' as const, color: 'white' },
        logo: { fontSize: '32px', fontWeight: '800', letterSpacing: '-1px', margin: '0', color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,0.1)' },
        badge: (bg: string, text: string, border: string) => ({ display: 'inline-flex', alignItems: 'center', padding: '8px 16px', borderRadius: '100px', fontSize: '13px', fontWeight: '700', marginBottom: '28px', letterSpacing: '0.02em', textTransform: 'uppercase' as const, backgroundColor: bg, color: text, border: `1px solid ${border}` }),
        content: { padding: '48px 40px', color: '#334155' },
        title: { fontSize: '28px', fontWeight: '800', marginBottom: '16px', textAlign: 'center' as const, color: '#0f172a', letterSpacing: '-0.03em', marginTop: '0', lineHeight: '1.2' },
        text: { fontSize: '17px', lineHeight: '1.6', marginBottom: '36px', color: '#64748b', textAlign: 'center' as const, fontWeight: '400' },
        grid: { display: 'flex', width: '100%', marginBottom: '36px', gap: '16px' },
        card: { flex: 1, backgroundColor: '#f8fafc', padding: '24px', borderRadius: '16px', textAlign: 'center' as const, border: '1px solid #eef2f6' },
        value: { display: 'block', fontSize: '26px', fontWeight: '800', color: '#0f172a', marginBottom: '6px', letterSpacing: '-0.02em' },
        label: { fontSize: '12px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.1em' },
        buttonContainer: { textAlign: 'center' as const },
        button: (bg?: string) => ({ background: bg || 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)', color: '#ffffff', padding: '18px 40px', borderRadius: '100px', textDecoration: 'none', fontWeight: '700', fontSize: '16px', display: 'inline-block', boxShadow: '0 10px 15px -3px rgba(79, 70, 229, 0.3)', border: 'none' }),
        footer: { backgroundColor: '#f8fafc', padding: '32px 40px', textAlign: 'center' as const, fontSize: '14px', color: '#94a3b8', borderTop: '1px solid #f1f5f9', lineHeight: '1.5' },
        errorDetails: { backgroundColor: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '16px', padding: '24px', marginBottom: '36px', color: '#991b1b', textAlign: 'center' as const, fontWeight: '500' },
        detailBox: { backgroundColor: '#f8fafc', border: '1px solid #eef2f6', borderRadius: '16px', padding: '24px', marginBottom: '36px' },
        detailLabel: { fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '8px' },
        detailValue: { fontSize: '15px', fontWeight: '600', color: '#1e293b', lineHeight: '1.4' },
        statusColors: {
            success: { bg: '#ecfdf5', text: '#059669', border: '#10b981', bar: '#10b981' },
            failed: { bg: '#fff1f2', text: '#e11d48', border: '#f43f5e', bar: '#e11d48' },
            scheduled: { bg: '#eef2ff', text: '#4f46e5', border: '#6366f1', bar: '#4f46e5' }
        }
    };

    const TaskDetailsBox = () => (
        (mockTask.editingRules || mockTask.appliesTo) ? (
            <div style={styles.detailBox}>
                {mockTask.editingRules && (
                    <div style={{ marginBottom: '20px' }}>
                        <div style={styles.detailLabel}>Editing Rules</div>
                        <div style={styles.detailValue}>{mockTask.editingRules}</div>
                    </div>
                )}
                {mockTask.appliesTo && (
                    <div>
                        <div style={styles.detailLabel}>Applies To</div>
                        <div style={styles.detailValue}>{mockTask.appliesTo}</div>
                    </div>
                )}
            </div>
        ) : null
    );

    const SuccessEmail = () => {
        const c = styles.statusColors.success;
        return (
            <div style={styles.container}>
                <div style={styles.accentBar(c.bar)} />
                <div style={styles.header}>
                    <div style={styles.badge(c.bg, c.text, c.border)}>✓ Update Complete</div>
                    <div style={styles.logo}>Bulkify</div>
                </div>
                <div style={styles.content}>
                    <h1 style={styles.title}>Task Completed</h1>
                    <p style={styles.text}>Your bulk update task <strong>"{mockTask.name}"</strong> has finished successfully.</p>
                    <TaskDetailsBox />
                    <div style={styles.grid}>
                        <div style={styles.card}><span style={styles.value}>{mockTask.productsCount}</span><span style={styles.label}>Products</span></div>
                        <div style={styles.card}><span style={styles.value}>{mockTask.duration}</span><span style={styles.label}>Duration</span></div>
                    </div>
                    <div style={styles.buttonContainer}><span style={styles.button()}>View Summary</span></div>
                </div>
                <div style={styles.footer}><p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>{mockTask.shopName}</p><p style={{ margin: '4px 0 0 0' }}>Sent via Bulkify: Smart Bulk Editor</p></div>
            </div>
        );
    };

    const ScheduledEmail = ({ type = 'task' }: { type?: 'task' | 'revert' }) => {
        const c = styles.statusColors.scheduled;
        return (
            <div style={styles.container}>
                <div style={styles.accentBar(c.bar)} />
                <div style={styles.header}>
                    <div style={styles.badge(c.bg, c.text, c.border)}>{type === 'revert' ? '⏰ Revert set' : '⏰ Task set'}</div>
                    <div style={styles.logo}>Bulkify</div>
                </div>
                <div style={styles.content}>
                    <h1 style={styles.title}>{type === 'revert' ? 'Revert Scheduled' : 'Task Scheduled'}</h1>
                    <p style={styles.text}>{type === 'revert' ? `A revert for your task "${mockTask.name}" has been scheduled.` : `Your bulk update task "${mockTask.name}" has been scheduled and will start automatically.`}</p>
                    <TaskDetailsBox />
                    <div style={{ ...styles.errorDetails, backgroundColor: '#f8fafc', border: '1px solid #eef2f6', color: '#0f172a' }}>
                        <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', color: '#94a3b8' }}>Execution Time</div>
                        <div style={{ fontSize: '18px', fontWeight: '800', color: '#4f46e5' }}>{mockTask.scheduledAt}</div>
                    </div>
                    <div style={styles.buttonContainer}><span style={styles.button()}>View Task Details</span></div>
                </div>
                <div style={styles.footer}><p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>{mockTask.shopName}</p><p style={{ margin: '4px 0 0 0' }}>Sent via Bulkify: Smart Bulk Editor</p></div>
            </div>
        );
    };

    const RevertCompletedEmail = () => {
        const c = styles.statusColors.success;
        return (
            <div style={styles.container}>
                <div style={styles.accentBar(c.bar)} />
                <div style={styles.header}>
                    <div style={styles.badge(c.bg, c.text, c.border)}>↺ Revert Complete</div>
                    <div style={styles.logo}>Bulkify</div>
                </div>
                <div style={styles.content}>
                    <h1 style={styles.title}>Changes Reverted</h1>
                    <p style={styles.text}>The changes from your task <strong>"{mockTask.name}"</strong> have been successfully reverted to their original state.</p>
                    <TaskDetailsBox />
                    <div style={styles.grid}>
                        <div style={styles.card}><span style={styles.value}>{mockTask.productsCount}</span><span style={styles.label}>Products Reverted</span></div>
                        <div style={styles.card}><span style={styles.value}>{mockTask.completedAt}</span><span style={styles.label}>Reverted At</span></div>
                    </div>
                    <div style={styles.buttonContainer}><span style={styles.button()}>View Summary</span></div>
                </div>
                <div style={styles.footer}><p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>{mockTask.shopName}</p><p style={{ margin: '4px 0 0 0' }}>Sent via Bulkify: Smart Bulk Editor</p></div>
            </div>
        );
    };

    const FailedEmail = () => {
        const c = styles.statusColors.failed;
        return (
            <div style={styles.container}>
                <div style={styles.accentBar(c.bar)} />
                <div style={styles.header}>
                    <div style={styles.badge(c.bg, c.text, c.border)}>⚠️ Action Required</div>
                    <div style={styles.logo}>Bulkify</div>
                </div>
                <div style={styles.content}>
                    <h1 style={styles.title}>Task Failed</h1>
                    <p style={styles.text}>We couldn't complete your task <strong>"{mockTask.name}"</strong> because of an error.</p>
                    <TaskDetailsBox />
                    <div style={styles.errorDetails}>
                        <div style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', color: '#be123c' }}>Error Details</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '14px' }}>{mockTask.error}</div>
                    </div>
                    <div style={styles.buttonContainer}><span style={styles.button(c.bar)}>View Error Log</span></div>
                </div>
                <div style={styles.footer}><p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>{mockTask.shopName}</p><p style={{ margin: '4px 0 0 0' }}>Sent via Bulkify: Smart Bulk Editor</p></div>
            </div>
        );
    };

    return (
        <Page
            fullWidth
        >
            <BlockStack gap="800">
                {/* Header Section */}
                <div className="premium-hero-mini">
                    <div className="glass-element" style={{ top: '-10%', right: '-5%', width: '200px', height: '200px' }} />
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <BlockStack gap="200">
                            <Text as="h1" variant="heading2xl" fontWeight="bold">
                                Email Notification Preview
                            </Text>
                            <Text as="p" variant="bodyLg">
                                <span style={{ opacity: 0.9 }}>Preview and test your automated store notifications.</span>
                            </Text>
                        </BlockStack>
                        <InlineStack gap="300">
                            <Button
                                onClick={() => navigate("/app/settings")}
                            >
                                Back to Settings
                            </Button>
                            <Button
                                variant="primary"
                                size="large"
                                onClick={() => submit({ type: emailType }, { method: "POST" })}
                                loading={isSending}
                                disabled={isSending}
                            >
                                Send Test Email
                            </Button>
                        </InlineStack>
                    </div>
                </div>

                <Layout>
                    <Layout.Section>
                        {actionData?.success && <div style={{ marginBottom: '20px' }}><Banner tone="success">{actionData.success}</Banner></div>}
                        {actionData?.error && <div style={{ marginBottom: '20px' }}><Banner tone="critical">{actionData.error}</Banner></div>}
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text as="h2" variant="headingMd">Template Preview</Text>
                                    <Select label="Email Type" labelHidden options={[
                                        { label: 'Task Completed', value: 'success' },
                                        { label: 'Task Failed', value: 'failed' },
                                        { label: 'Task Scheduled', value: 'scheduled' },
                                        { label: 'Revert Scheduled', value: 'revert_scheduled' },
                                        { label: 'Revert Completed', value: 'revert_completed' },
                                    ]} onChange={setEmailType} value={emailType} />
                                </InlineStack>
                                <Divider />
                                <div style={styles.viewportContainer}>
                                    <div style={styles.deviceWrapper}>
                                        {emailType === 'success' && <SuccessEmail />}
                                        {emailType === 'failed' && <FailedEmail />}
                                        {emailType === 'scheduled' && <ScheduledEmail type="task" />}
                                        {emailType === 'revert_scheduled' && <ScheduledEmail type="revert" />}
                                        {emailType === 'revert_completed' && <RevertCompletedEmail />}
                                    </div>
                                </div>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
