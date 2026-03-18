import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import premiumStyles from "./styles/premium.css?url";
import tasksStyles from "./styles/tasks.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: premiumStyles },
  { rel: "stylesheet", href: tasksStyles },
];

export default function App() {
  const location = useLocation();
  const path = location.pathname;
  
  // Show chat on all public site pages (not starting with /app).
  // Inside the shopify app, strictly mount on dashboard, plans, settings, and tasks flows.
  const isAppRoute = path.startsWith('/app');
  const allowedAppRoutes = ['/app', '/app/plans', '/app/settings', '/app/tasks'];
  
  // Exact match for '/app', or starts with specific subroutes.
  const shouldShowChat = !isAppRoute || allowedAppRoutes.some(route => path === route || path.startsWith(route + '/'));

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
        {shouldShowChat && (
          <script type="text/javascript" dangerouslySetInnerHTML={{ __html: `window.$crisp=[];window.CRISP_WEBSITE_ID="ff00e6ce-a15c-4501-bf03-5d83cf0c4641";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();` }} />
        )}
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
