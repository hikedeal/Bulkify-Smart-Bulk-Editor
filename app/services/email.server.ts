
import { Resend } from 'resend';

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

interface TaskEmailData {
    taskName: string;
    taskId: string;
    productsCount?: number;
    duration?: string;
    completedAt?: string;
    scheduledAt?: string;
    error?: string;
    shopName: string;
    shopDomain: string;
    toEmail: string;
    description?: string;
    editingRules?: string;
    appliesTo?: string;
}

// Inline CSS Styles for Email - Premium Design System
const styles = {
    wrapper: 'background-color: #f1f5f9; padding: 60px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; width: 100%; box-sizing: border-box;',
    container: 'max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); border: 1px solid #e2e8f0; position: relative;',
    accentBar: 'height: 6px; width: 100%; position: absolute; top: 0; left: 0;',
    header: 'background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 50px 40px; text-align: center; color: white;',
    logo: 'font-size: 32px; font-weight: 800; letter-spacing: -1px; margin: 0; color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.1);',
    badge: 'display: inline-flex; align-items: center; padding: 8px 16px; border-radius: 100px; font-size: 13px; font-weight: 700; margin-bottom: 28px; letter-spacing: 0.02em; text-transform: uppercase;',
    content: 'padding: 48px 40px; color: #334155;',
    title: 'font-size: 28px; font-weight: 800; margin-bottom: 16px; text-align: center; color: #0f172a; letter-spacing: -0.03em; margin-top: 0; line-height: 1.2;',
    text: 'font-size: 17px; line-height: 1.6; margin-bottom: 36px; color: #64748b; text-align: center; font-weight: 400;',
    grid: 'display: table; width: 100%; margin-bottom: 36px; border-spacing: 16px 0; border-collapse: separate;',
    card: 'display: table-cell; width: 50%; background-color: #f8fafc; padding: 24px; border-radius: 16px; text-align: center; border: 1px solid #eef2f6;',
    value: 'display: block; font-size: 26px; font-weight: 800; color: #0f172a; margin-bottom: 6px; letter-spacing: -0.02em;',
    label: 'font-size: 12px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;',
    buttonContainer: 'text-align: center;',
    button: 'background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: #ffffff !important; padding: 18px 40px; border-radius: 100px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block; box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3); transition: all 0.2s ease;',
    footer: 'background-color: #f8fafc; padding: 32px 40px; text-align: center; font-size: 14px; color: #94a3b8; border-top: 1px solid #f1f5f9; line-height: 1.5;',
    errorBox: 'background-color: #fff1f2; border: 1px solid #ffe4e6; border-radius: 16px; padding: 24px; margin-bottom: 36px; color: #991b1b; text-align: center; font-weight: 500;',
    statusColors: {
        success: { bg: '#ecfdf5', text: '#059669', border: '#10b981', bar: '#10b981' },
        failed: { bg: '#fff1f2', text: '#e11d48', border: '#f43f5e', bar: '#e11d48' },
        scheduled: { bg: '#eef2ff', text: '#4f46e5', border: '#6366f1', bar: '#4f46e5' }
    }
};

const commonMeta = `
    <style>
        @media screen and (max-width: 600px) {
            .email-grid { display: block !important; border-spacing: 0 !important; }
            .email-card { display: block !important; width: 100% !important; margin-bottom: 16px !important; box-sizing: border-box !important; }
            .email-card:last-child { margin-bottom: 0 !important; }
            .mobile-content { padding: 32px 24px !important; }
            .mobile-header { padding: 40px 24px !important; }
            .mobile-title { font-size: 24px !important; }
        }
    </style>
`;

function generateSuccessHtml(data: TaskEmailData) {
    const color = styles.statusColors.success;
    return `
    ${commonMeta}
    <div style="${styles.wrapper}">
        <div style="${styles.container}">
            <div style="${styles.accentBar} background-color: ${color.bar};"></div>
            <div style="${styles.header}" class="mobile-header">
                <div style="${styles.badge} background-color: ${color.bg}; color: ${color.text}; border: 1px solid ${color.border};">✓ Update Complete</div>
                <div style="${styles.logo}">Bulkify</div>
            </div>
            <div style="${styles.content}" class="mobile-content">
                <h1 style="${styles.title}" class="mobile-title">Task Completed</h1>
                <p style="${styles.text}">
                    Your bulk update task <strong>"${data.taskName}"</strong> has finished successfully.
                </p>
                
                ${data.description ? `
                <div style="background-color: #f8fafc; border: 1px solid #eef2f6; border-radius: 16px; padding: 24px; margin-bottom: 36px; text-align: left;">
                    ${data.description.includes(' • ') ? `
                        <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 15px; font-weight: 500; line-height: 1.6;">
                            ${data.description.split(' • ').map(part => `<li style="margin-bottom: 8px;">${part}</li>`).join('')}
                        </ul>
                    ` : `
                        <span style="font-size: 15px; color: #475569; font-weight: 500; display: block; text-align: center;">${data.description}</span>
                    `}
                </div>
                ` : ''}
                
                <table style="${styles.grid}" role="presentation" class="email-grid">
                    <tr>
                        <td style="${styles.card}" class="email-card">
                            <span style="${styles.value}">${data.productsCount}</span>
                            <span style="${styles.label}">Products</span>
                        </td>
                        <td style="${styles.card}" class="email-card">
                            <span style="${styles.value}">${data.duration || 'N/A'}</span>
                            <span style="${styles.label}">Duration</span>
                        </td>
                    </tr>
                </table>

                ${(data.editingRules || data.appliesTo) ? `
                <div style="background-color: #f8fafc; border: 1px solid #eef2f6; border-radius: 16px; padding: 24px; margin-bottom: 36px;">
                    ${data.editingRules ? `
                        <div style="margin-bottom: 20px;">
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Editing Rules</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.editingRules}</div>
                        </div>
                    ` : ''}
                    ${data.appliesTo ? `
                        <div>
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Applies To</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.appliesTo}</div>
                        </div>
                    ` : ''}
                </div>
                ` : ''}
 
                <div style="${styles.buttonContainer}">
                    <a href="https://${data.shopDomain}/admin/apps/axiom-smart-price-editor/app/tasks/${data.taskId}" style="${styles.button}">View Summary</a>
                </div>
            </div>
            <div style="${styles.footer}">
                <p style="margin: 0; font-weight: 600; color: #64748b;">${data.shopName}</p>
                <p style="margin: 4px 0 0 0;">Sent via Bulkify: Smart Bulk Editor</p>
            </div>
        </div>
    </div>
    `;
}

function generateFailedHtml(data: TaskEmailData) {
    const color = styles.statusColors.failed;
    return `
    ${commonMeta}
    <div style="${styles.wrapper}">
        <div style="${styles.container}">
            <div style="${styles.accentBar} background-color: ${color.bar};"></div>
            <div style="${styles.header}" class="mobile-header">
                <div style="${styles.badge} background-color: ${color.bg}; color: ${color.text}; border: 1px solid ${color.border};">⚠️ Action Required</div>
                <div style="${styles.logo}">Bulkify</div>
            </div>
            <div style="${styles.content}" class="mobile-content">
                <h1 style="${styles.title}" class="mobile-title">Task Failed</h1>
                <p style="${styles.text}">
                    We couldn't complete your task <strong>"${data.taskName}"</strong> because of an error.
                </p>
                
                ${(data.editingRules || data.appliesTo) ? `
                <div style="background-color: #f8fafc; border: 1px solid #eef2f6; border-radius: 16px; padding: 24px; margin-bottom: 36px;">
                    ${data.editingRules ? `
                        <div style="margin-bottom: 20px;">
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Editing Rules</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.editingRules}</div>
                        </div>
                    ` : ''}
                    ${data.appliesTo ? `
                        <div>
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Applies To</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.appliesTo}</div>
                        </div>
                    ` : ''}
                </div>
                ` : ''}

                <div style="${styles.errorBox}">
                    <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; color: #be123c;">Error Details</div>
                    <div style="font-family: monospace; font-size: 14px;">${data.error}</div>
                </div>

                <div style="${styles.buttonContainer}">
                    <a href="https://${data.shopDomain}/admin/apps/axiom-smart-price-editor/app/tasks/${data.taskId}" style="${styles.button}; background: ${color.bar}; box-shadow: 0 10px 15px -3px rgba(225, 29, 72, 0.3);">View Error Log</a>
                </div>
            </div>
            <div style="${styles.footer}">
                <p style="margin: 0; font-weight: 600; color: #64748b;">${data.shopName}</p>
                <p style="margin: 4px 0 0 0;">Sent via Bulkify: Smart Bulk Editor</p>
            </div>
        </div>
    </div>
    `;
}

function generateScheduledHtml(data: TaskEmailData, type: 'task' | 'revert' = 'task') {
    const color = styles.statusColors.scheduled;
    const title = type === 'revert' ? 'Revert Scheduled' : 'Task Scheduled';
    const badgeText = type === 'revert' ? '⏰ Revert set' : '⏰ Task set';
    const bodyText = type === 'revert'
        ? `A revert for your task <strong>"${data.taskName}"</strong> has been scheduled.`
        : `Your bulk update task <strong>"${data.taskName}"</strong> has been scheduled and will start automatically.`;

    return `
    ${commonMeta}
    <div style="${styles.wrapper}">
        <div style="${styles.container}">
            <div style="${styles.accentBar} background-color: ${color.bar};"></div>
            <div style="${styles.header}" class="mobile-header">
                <div style="${styles.badge} background-color: ${color.bg}; color: ${color.text}; border: 1px solid ${color.border};">${badgeText}</div>
                <div style="${styles.logo}">Bulkify</div>
            </div>
            <div style="${styles.content}" class="mobile-content">
                <h1 style="${styles.title}" class="mobile-title">${title}</h1>
                <p style="${styles.text}">${bodyText}</p>
                
                ${(data.editingRules || data.appliesTo) ? `
                <div style="background-color: #f8fafc; border: 1px solid #eef2f6; border-radius: 16px; padding: 24px; margin-bottom: 36px;">
                    ${data.editingRules ? `
                        <div style="margin-bottom: 20px;">
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Editing Rules</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.editingRules}</div>
                        </div>
                    ` : ''}
                    ${data.appliesTo ? `
                        <div>
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Applies To</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.appliesTo}</div>
                        </div>
                    ` : ''}
                </div>
                ` : ''}

                <div style="${styles.errorBox}; background-color: #f8fafc; border: 1px solid #eef2f6; color: #0f172a;">
                    <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; color: #94a3b8;">Execution Time</div>
                    <div style="font-size: 18px; font-weight: 800; color: #4f46e5;">${data.scheduledAt || 'N/A'}</div>
                </div>

                <div style="${styles.buttonContainer}">
                    <a href="https://${data.shopDomain}/admin/apps/axiom-smart-price-editor/app/tasks/${data.taskId}" style="${styles.button}">View Task Details</a>
                </div>
            </div>
            <div style="${styles.footer}">
                <p style="margin: 0; font-weight: 600; color: #64748b;">${data.shopName}</p>
                <p style="margin: 4px 0 0 0;">Sent via Bulkify: Smart Bulk Editor</p>
            </div>
        </div>
    </div>
    `;
}

function generateRevertCompletedHtml(data: TaskEmailData) {
    const color = styles.statusColors.success;
    return `
    ${commonMeta}
    <div style="${styles.wrapper}">
        <div style="${styles.container}">
            <div style="${styles.accentBar} background-color: ${color.bar};"></div>
            <div style="${styles.header}" class="mobile-header">
                <div style="${styles.badge} background-color: ${color.bg}; color: ${color.text}; border: 1px solid ${color.border};">↺ Revert Complete</div>
                <div style="${styles.logo}">Bulkify</div>
            </div>
            <div style="${styles.content}" class="mobile-content">
                <h1 style="${styles.title}" class="mobile-title">Changes Reverted</h1>
                <p style="${styles.text}">
                    The changes from your task <strong>"${data.taskName}"</strong> have been successfully reverted to their original state.
                </p>
                
                <table style="${styles.grid}" role="presentation" class="email-grid">
                    <tr>
                        <td style="${styles.card}" class="email-card">
                            <span style="${styles.value}">${data.productsCount}</span>
                            <span style="${styles.label}">Products Reverted</span>
                        </td>
                        <td style="${styles.card}" class="email-card">
                            <span style="${styles.value}">${data.completedAt || 'N/A'}</span>
                            <span style="${styles.label}">Reverted At</span>
                        </td>
                    </tr>
                </table>

                ${(data.editingRules || data.appliesTo) ? `
                <div style="background-color: #f8fafc; border: 1px solid #eef2f6; border-radius: 16px; padding: 24px; margin-bottom: 36px;">
                    ${data.editingRules ? `
                        <div style="margin-bottom: 20px;">
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Editing Rules</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.editingRules}</div>
                        </div>
                    ` : ''}
                    ${data.appliesTo ? `
                        <div>
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Applies To</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.4;">${data.appliesTo}</div>
                        </div>
                    ` : ''}
                </div>
                ` : ''}

                <div style="${styles.buttonContainer}">
                    <a href="https://${data.shopDomain}/admin/apps/axiom-smart-price-editor/app/tasks/${data.taskId}" style="${styles.button}">View Summary</a>
                </div>
            </div>
            <div style="${styles.footer}">
                <p style="margin: 0; font-weight: 600; color: #64748b;">${data.shopName}</p>
                <p style="margin: 4px 0 0 0;">Sent via Bulkify: Smart Bulk Editor</p>
            </div>
        </div>
    </div>
    `;
}

export async function sendTaskCompletedEmail(data: TaskEmailData) {
    try {
        const response = await resend.emails.send({
            from: 'Bulkify App <onboarding@resend.dev>',
            to: data.toEmail,
            subject: `Task Completed: ${data.taskName}`,
            html: generateSuccessHtml(data),
        });
        console.log(`Success email sent to ${data.toEmail}. ID: ${response.data?.id}`);
        return response;
    } catch (error) {
        console.error('Failed to send success email:', error);
        throw error;
    }
}

export async function sendTaskFailedEmail(data: TaskEmailData) {
    try {
        const response = await resend.emails.send({
            from: 'Bulkify App <onboarding@resend.dev>',
            to: data.toEmail,
            subject: `Task Failed: ${data.taskName}`,
            html: generateFailedHtml(data),
        });
        console.log(`Failure email sent to ${data.toEmail}. ID: ${response.data?.id}`);
        return response;
    } catch (error) {
        console.error('Failed to send failure email:', error);
        throw error;
    }
}

export async function sendTaskScheduledEmail(data: TaskEmailData) {
    try {
        const response = await resend.emails.send({
            from: 'Bulkify App <onboarding@resend.dev>',
            to: data.toEmail,
            subject: `Task Scheduled: ${data.taskName}`,
            html: generateScheduledHtml(data, 'task'),
        });
        return response;
    } catch (error) {
        console.error('Failed to send scheduled email:', error);
        throw error;
    }
}

export async function sendRevertScheduledEmail(data: TaskEmailData) {
    try {
        const response = await resend.emails.send({
            from: 'Bulkify App <onboarding@resend.dev>',
            to: data.toEmail,
            subject: `Revert Scheduled: ${data.taskName}`,
            html: generateScheduledHtml(data, 'revert'),
        });
        return response;
    } catch (error) {
        console.error('Failed to send revert scheduled email:', error);
        throw error;
    }
}

export async function sendRevertCompletedEmail(data: TaskEmailData) {
    try {
        const response = await resend.emails.send({
            from: 'Bulkify App <onboarding@resend.dev>',
            to: data.toEmail,
            subject: `Revert Complete: ${data.taskName}`,
            html: generateRevertCompletedHtml(data),
        });
        return response;
    } catch (error) {
        console.error('Failed to send revert complete email:', error);
        throw error;
    }
}
export async function sendRevertFailedEmail(data: TaskEmailData) {
    try {
        const response = await resend.emails.send({
            from: 'Bulkify App <onboarding@resend.dev>',
            to: data.toEmail,
            subject: `Revert Failed: ${data.taskName}`,
            html: generateFailedHtml(data),
        });
        console.log(`Revert failure email sent to ${data.toEmail}. ID: ${response.data?.id}`);
        return response;
    } catch (error) {
        console.error('Failed to send revert failure email:', error);
        throw error;
    }
}
