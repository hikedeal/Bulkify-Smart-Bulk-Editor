import LandingLayout from "../components/LandingLayout";
import styles from "./_index/styles.module.css";

export default function PricingPage() {
  return (
    <LandingLayout>
      <div className={styles.pricing} style={{ padding: '10rem 5%' }}>
        <h1 style={{ fontSize: '4rem', fontWeight: 800, marginBottom: '1.5rem' }}>Simple, transparent pricing</h1>
        <p style={{ color: '#64748b', fontSize: '1.2rem', marginBottom: '5rem' }}>Choose the plan that's right for your store size.</p>
        <div className={styles.pricingGrid}>
          <div className={styles.priceCard}><h4>FREE</h4><div className={styles.priceVal}>$0<span>/mo</span></div><ul><li className={styles.featureItem}>✓ 1,000 Edits / mo</li><li className={styles.featureItem}>✓ Basic Filters</li><li className={styles.featureItem}>✓ Email Support</li></ul></div>
          <div className={styles.priceCard}><h4>ESSENTIAL</h4><div className={styles.priceVal}>$9<span>/mo</span></div><ul><li className={styles.featureItem}>✓ 5,000 Edits / mo</li><li className={styles.featureItem}>✓ Advanced Filters</li><li className={styles.featureItem}>✓ Priority Email</li></ul></div>
          <div className={`${styles.priceCard} ${styles.featured}`}><h4>PRO</h4><div className={styles.priceVal}>$15<span>/mo</span></div><p style={{ color: '#ff4d4d', fontWeight: 'bold' }}>MOST POPULAR</p><ul><li className={styles.featureItem}>✓ Unlimited Updates</li><li className={styles.featureItem}>✓ Metafield Editor</li><li className={styles.featureItem}>✓ 24/7 Priority Support</li></ul></div>
          <div className={styles.priceCard}><h4>CUSTOM</h4><div className={styles.priceVal}>Contact</div><ul><li className={styles.featureItem}>✓ 1M+ Products</li><li className={styles.featureItem}>✓ API Access</li><li className={styles.featureItem}>✓ Account Manager</li></ul></div>
        </div>
      </div>
    </LandingLayout>
  );
}
