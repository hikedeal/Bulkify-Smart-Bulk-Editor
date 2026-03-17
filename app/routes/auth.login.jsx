import { useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { Page, Card, FormLayout, TextField, Button, Text, BlockStack, AppProvider } from "@shopify/polaris";
import translations from "@shopify/polaris/locales/en.json";
import { login } from "../shopify.server";

export const loader = async ({ request }) => {
    const errors = await login(request);
    return errors;
};

export const action = async ({ request }) => {
    const errors = await login(request);
    return errors;
};

export default function AuthLogin() {
    const loaderData = useLoaderData();
    const actionData = useActionData();
    const [shop, setShop] = useState("");
    const { errors } = actionData || loaderData || {};

    return (
        <AppProvider i18n={translations}>
            <Page>
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '100px' }}>
                    <div style={{ width: '400px' }}>
                        <Card>
                            <BlockStack gap="500">
                                <Text as="h2" variant="headingMd">
                                    Log in
                                </Text>
                                <Form method="post">
                                    <FormLayout>
                                        <Text variant="bodyMd" as="p">
                                            Enter your shop domain to log in or install this app.
                                        </Text>
                                        <TextField
                                            label="Shop domain"
                                            type="text"
                                            name="shop"
                                            value={shop}
                                            onChange={setShop}
                                            autoComplete="on"
                                            error={errors?.shop}
                                            placeholder="my-shop.myshopify.com"
                                        />
                                        <Button submit variant="primary">Log in</Button>
                                    </FormLayout>
                                </Form>
                            </BlockStack>
                        </Card>
                    </div>
                </div>
            </Page>
        </AppProvider>
    );
}
