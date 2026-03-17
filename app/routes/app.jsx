import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as AppProviderPolaris } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const isAdmin = ["hikedeal-2.myshopify.com"].includes(session.shop);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    isAdmin
  };
};

export default function App() {
  const { apiKey, isAdmin } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AppProviderPolaris i18n={polarisTranslations}>
        <s-app-nav>
          <s-link href="/app/tasks">Tasks</s-link>
          <s-link href="/app/plans">Plans</s-link>
          <s-link href="/app/settings">Settings</s-link>
          {isAdmin && (
            <>
              <s-link href="/app/owner-dashboard">Owner Dashboard</s-link>
              <s-link href="/app/support-admin">Support Admin</s-link>
            </>
          )}
        </s-app-nav>
        <Outlet />
      </AppProviderPolaris>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
