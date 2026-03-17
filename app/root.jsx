import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import premiumStyles from "./styles/premium.css?url";
import tasksStyles from "./styles/tasks.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: premiumStyles },
  { rel: "stylesheet", href: tasksStyles },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
