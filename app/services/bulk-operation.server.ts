import { sessionStorage } from "../shopify.server";

/**
 * Service to handle Shopify Bulk Operations (JSONL based).
 * This bypasses standard throttles for massive catalog updates.
 */

interface StagedUploadTarget {
    url: string;
    parameters: { name: string; value: string }[];
    resourceUrl: string;
}

export async function createStagedUpload(shopDomain: string, filename: string): Promise<StagedUploadTarget> {
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    const offlineSession = sessions.find((s: any) => s.isOnline === false);

    if (!offlineSession || !offlineSession.accessToken) {
        throw new Error(`No offline session found for shop: ${shopDomain}`);
    }

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
                query: `#graphql
                mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
                    stagedUploadsCreate(input: $input) {
                        stagedTargets {
                            url
                            resourceUrl
                            parameters {
                                name
                                value
                            }
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                variables: {
                    input: [
                        {
                            filename,
                            mimeType: "text/jsonl",
                            resource: "BULK_MUTATION_VARIABLES",
                            httpMethod: "POST",
                        },
                    ],
                },
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const json = await response.json() as any;
        const target = json.data?.stagedUploadsCreate?.stagedTargets?.[0];
        const errors = json.data?.stagedUploadsCreate?.userErrors;

        if (errors?.length > 0) {
            throw new Error(`Failed to create staged upload: ${errors.map((e: any) => e.message).join(", ")}`);
        }

        return target;
    } finally {
        clearTimeout(timeoutId);
    }


}

export async function uploadJsonl(target: StagedUploadTarget, jsonlContent: string) {
    const formData = new FormData();

    // Shopify parameters must be added exactly as returned
    for (const param of target.parameters) {
        formData.append(param.name, param.value);
    }

    // The file must be the last parameter for S3-based uploads
    const blob = new Blob([jsonlContent], { type: 'text/jsonl' });
    formData.append('file', blob);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

    try {
        const response = await fetch(target.url, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to upload JSONL to Shopify storage: ${response.statusText} - ${text}`);
        }
    } finally {
        clearTimeout(timeoutId);
    }

    const keyParam = target.parameters.find(p => p.name === 'key');
    if (keyParam) {
        return keyParam.value;
    }

    return target.resourceUrl;
}

export async function runBulkMutation(shopDomain: string, mutation: string, stagedUploadPath: string) {
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    const offlineSession = sessions.find((s: any) => s.isOnline === false);

    if (!offlineSession || !offlineSession.accessToken) {
        throw new Error(`No offline session found for shop: ${shopDomain}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes

    try {
        const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': offlineSession.accessToken!,
            },
            body: JSON.stringify({
                query: `#graphql
                mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
                    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
                        bulkOperation {
                            id
                            status
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                variables: {
                    mutation,
                    stagedUploadPath,
                },
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const json = await response.json() as any;
        const operation = json.data?.bulkOperationRunMutation?.bulkOperation;
        const errors = json.data?.bulkOperationRunMutation?.userErrors;

        if (errors?.length > 0) {
            const msg = errors.map((e: any) => e.message).join(", ");
            if (msg.includes("already in progress")) {
                throw new Error(`BULK_MUTATION_IN_PROGRESS: ${msg}`);
            }
            throw new Error(`Failed to start bulk operation: ${msg}`);
        }

        return operation;
    } finally {
        clearTimeout(timeoutId);
    }


}
export async function runBulkQuery(shopDomain: string, query: string) {
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    const offlineSession = sessions.find((s: any) => s.isOnline === false);

    if (!offlineSession || !offlineSession.accessToken) {
        throw new Error(`No offline session found for shop: ${shopDomain}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes

    try {
        const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': offlineSession.accessToken!,
            },
            body: JSON.stringify({
                query: `#graphql
                mutation bulkOperationRunQuery($query: String!) {
                    bulkOperationRunQuery(query: $query) {
                        bulkOperation {
                            id
                            status
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                variables: {
                    query,
                },
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const json = await response.json() as any;
        const operation = json.data?.bulkOperationRunQuery?.bulkOperation;
        const errors = json.data?.bulkOperationRunQuery?.userErrors;

        if (errors?.length > 0) {
            const msg = errors.map((e: any) => e.message).join(", ");
            if (msg.includes("already in progress")) {
                throw new Error(`BULK_QUERY_IN_PROGRESS: ${msg}`);
            }
            throw new Error(`Failed to start bulk query: ${msg}`);
        }

        return operation;
    } finally {
        clearTimeout(timeoutId);
    }


}
export async function cancelBulkOperation(shopDomain: string, operationId: string) {
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    const offlineSession = sessions.find((s: any) => s.isOnline === false);

    if (!offlineSession || !offlineSession.accessToken) {
        throw new Error(`No offline session found for shop: ${shopDomain}`);
    }

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
                query: `#graphql
                mutation bulkOperationCancel($id: ID!) {
                    bulkOperationCancel(id: $id) {
                        bulkOperation {
                            id
                            status
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                variables: {
                    id: operationId,
                },
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const json = await response.json() as any;
        const operation = json.data?.bulkOperationCancel?.bulkOperation;
        const errors = json.data?.bulkOperationCancel?.userErrors;

        if (errors?.length > 0) {
            throw new Error(`Failed to cancel bulk operation: ${errors.map((e: any) => e.message).join(", ")}`);
        }

        return operation;
    } finally {
        clearTimeout(timeoutId);
    }


}
