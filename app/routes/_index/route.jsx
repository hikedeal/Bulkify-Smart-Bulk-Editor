import { redirect, Form, useLoaderData } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Bulkify: Smart Bulk Editor</h1>
        <p className={styles.text}>
          The most powerful bulk editing tool for your Shopify store.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Bulk Edit Everything</strong>. Prices, inventory, tags, metafields, and more.
          </li>
          <li>
            <strong>Safe & Reversible</strong>. Every change can be reverted with a single click.
          </li>
          <li>
            <strong>Automation</strong>. Schedule tasks and sync inventory automatically.
          </li>
        </ul>
      </div>
    </div>
  );
}
