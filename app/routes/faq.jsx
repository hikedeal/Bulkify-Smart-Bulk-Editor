import LandingLayout from "../components/LandingLayout";
import styles from "./_index/styles.module.css";

export default function FAQPage() {
  return (
    <LandingLayout>
      <div className={styles.faqSection} style={{ padding: '10rem 5% 10rem' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 800, textAlign: 'center', marginBottom: '4rem' }}>Frequently Asked Questions</h1>
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
      </div>
    </LandingLayout>
  );
}
