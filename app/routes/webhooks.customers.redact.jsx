import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("Payload:", JSON.stringify(payload, null, 2));

    // Handle customer data deletion compliance here
    // This webhook is triggered when a customer asks to redact their data

    return new Response();
};
