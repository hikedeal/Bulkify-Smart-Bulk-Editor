import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (shop) throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <nav className={styles.nav}>
        <a href="/" className={styles.logo}>Bulkify</a>
        <div className={styles.navLinks}>
          <a href="#features" className={styles.navLink}>Products</a>
          <a href="#how" className={styles.navLink}>Process</a>
          <a href="/pricing" className={styles.navLink}>Pricing</a>
        </div>
        <div className={styles.navButtons}>
          <a href="/auth/login" className={styles.navLink} style={{ marginRight: '1rem' }}>Log in</a>
          <a href="/auth/login" className={styles.btnBlack}>Start for free</a>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.badge}>🟢 &nbsp; First 7 days - 100% Free</div>
        <h1 className={styles.heroTitle}>Turn store updates into <span className={styles.highlight}>growth</span></h1>
        <p className={styles.heroSubtitle}>Precision bulk edits for your Shopify catalog. Manage prices, inventory, tags and metafields at scale.</p>
        <div className={styles.heroCTA}>
          <a href="/auth/login" className={styles.btnBlack} style={{ padding: '1.2rem 3rem' }}>Get started now</a>
          <a href="#how" className={styles.navLink} style={{ padding: '1.2rem 2rem', border: '1px solid #e2e8f0', borderRadius: '99px' }}>How it works</a>
        </div>
      </section>

      <div className={styles.previewGrid}>
        <div className={styles.previewCard}><div className={styles.previewOverlay}><h4>💰 Price Editor</h4><p>Global MSRP adjustment.</p></div></div>
        <div className={styles.previewCard}><div className={styles.previewOverlay}><h4>📦 Stock Hub</h4><p>Real-time inventory sync.</p></div></div>
        <div className={styles.previewCard}><div className={styles.previewOverlay}><h4>🏷️ Tag Master</h4><p>Bulk tag architect.</p></div></div>
        <div className={styles.previewCard}><div className={styles.previewOverlay}><h4>🚦 Status Guard</h4><p>Safe publish/archive.</p></div></div>
        <div className={styles.previewCard}><div className={styles.previewOverlay}><h4>📂 Metafield Pro</h4><p>Custom data control.</p></div></div>
      </div>

      <section id="features" className={styles.features}>
        <span style={{ color: 'var(--primary)', fontWeight: 800 }}>FEATURES</span>
        <h2 style={{ fontSize: '3rem', marginTop: '1rem' }}>Built for Power Users</h2>
        <div className={styles.featureGrid}>
          <div className={styles.featureCard}><h3>💰 Price Manager</h3><p>Adjust thousands of prices with smart rounding logic.</p></div>
          <div className={styles.featureCard}><h3>📦 Live Inventory</h3><p>Sync levels across all warehouse locations instantly.</p></div>
          <div className={styles.featureCard}><h3>🏷️ Tag Architect</h3><p>Clean up your store organization in seconds.</p></div>
          <div className={styles.featureCard}><h3>📂 Metafield Master</h3><p>Complete control over custom fields and SEO.</p></div>
          <div className={styles.featureCard}><h3>🚦 Status Guard</h3><p>Bulk publish products with 1-click safety.</p></div>
          <div className={styles.featureCard}><h3>📉 Sale Scheduler</h3><p>Plan and execute seasonal sales across collections.</p></div>
        </div>
      </section>

      <section id="how" className={styles.steps}>
        <span style={{ color: 'var(--primary)', fontWeight: 800 }}>PROCESS</span>
        <h2 style={{ fontSize: '3rem', marginTop: '1rem' }}>Success in 3 steps</h2>
        <div className={styles.stepGrid}>
          <div className={styles.stepItem}><span className={styles.stepNum}>01</span><h3>Connect Shopify</h3><p>Link your store in one click. We sync your existing catalog safely.</p></div>
          <div className={styles.stepItem}><span className={styles.stepNum}>02</span><h3>Filter & Select</h3><p>Pinpoint products by tag, price, collection, or custom metafields.</p></div>
          <div className={styles.stepItem}><span className={styles.stepNum}>03</span><h3>Apply & Scale</h3><p>Apply updates instantly. Revert any change with a single click.</p></div>
        </div>
      </section>

      <section className={styles.faqSection}>
        <span style={{ color: 'var(--primary)', fontWeight: 800 }}>FAQ</span>
        <h2 style={{ fontSize: '3rem', marginTop: '1rem' }}>Common Questions</h2>
        <div className={styles.faqContainer}>
          <details className={styles.faqItem} open>
            <summary>How safe is Bulkify? <span>+</span></summary>
            <p>Extremely safe. We use Shopify's official API and every change is logged. You can undo any operation with one click.</p>
          </details>
          <details className={styles.faqItem}>
            <summary>Can I edit Metafields? <span>+</span></summary>
            <p>Yes! Bulkify Pro includes a full Metafield Architect for all your custom field needs.</p>
          </details>
          <details className={styles.faqItem}>
            <summary>What platforms do you support? <span>+</span></summary>
            <p>Currently we are exclusively built for Shopify stores of all sizes.</p>
          </details>
        </div>
      </section>

      <section id="pricing" className={styles.pricing}>
        <h2 style={{ fontSize: '3.5rem', fontWeight: 800 }}>Simple, transparent pricing</h2>
        <div className={styles.pricingGrid}>
          <div className={styles.priceCard}><h4>FREE</h4><div className={styles.priceVal}>$0<span>/mo</span></div><ul><li className={styles.featureItem}>✓ 1,000 Edits</li><li className={styles.featureItem}>✓ Basic Filters</li></ul></div>
          <div className={styles.priceCard}><h4>ESSENTIAL</h4><div className={styles.priceVal}>$9<span>/mo</span></div><ul><li className={styles.featureItem}>✓ 5,000 Edits</li><li className={styles.featureItem}>✓ All Features</li></ul></div>
          <div className={`${styles.priceCard} ${styles.featured}`}><h4>PRO</h4><div className={styles.priceVal}>$15<span>/mo</span></div><p style={{ color: 'var(--primary)', fontWeight: 'bold' }}>MOST POPULAR</p><ul><li className={styles.featureItem}>✓ Unlimited Updates</li><li className={styles.featureItem}>✓ Priority Support</li></ul></div>
          <div className={styles.priceCard}><h4>CUSTOM</h4><div className={styles.priceVal}>Contact</div><ul><li className={styles.featureItem}>✓ Enterprise Logic</li><li className={styles.featureItem}>✓ Account Manager</li></ul></div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <h2 style={{ fontSize: '3rem', marginBottom: '2rem' }}>Ready to scale your store?</h2>
        <a href="/auth/login" className={styles.btnRed}>Install Bulkify Now</a>
      </section>

      <footer className={styles.footer}>&copy; 2026 Bulkify Inc. The world's fastest Shopify bulk editor.</footer>
    </div>
  );
}
