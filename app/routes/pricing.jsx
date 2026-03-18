import { useState } from "react";
import { Link } from "react-router";
import LandingLayout from "../components/LandingLayout";
import styles from "./_index/styles.module.css";

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState("monthly");

  return (
    <LandingLayout>
      <div className={styles.pricingPreview} style={{ paddingTop: "12rem", minHeight: "80vh" }}>
        <div className={styles.sectionHeader} style={{ marginBottom: "2rem" }}>
          <span className={styles.sectionLabel}>PRICING</span>
          <h2 className={styles.sectionTitle}>Simple, transparent pricing</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "1.2rem", marginTop: "1rem" }}>Choose the plan that's right for your store size.</p>
        </div>

        <div className={styles.billingToggleWrapper}>
           <div className={styles.billingToggle}>
             <button 
               onPointerDown={() => setBillingCycle("monthly")}
               className={billingCycle === "monthly" ? styles.activeToggle : ""}
             >
               Monthly
             </button>
             <button 
               onPointerDown={() => setBillingCycle("yearly")}
               className={billingCycle === "yearly" ? styles.activeToggle : ""}
             >
               Yearly <span className={styles.saveBadge}>Save $30</span>
             </button>
           </div>
        </div>

        <div className={styles.pricingGrid}>
          <div className={styles.priceCard}>
            <h4>FREE</h4>
            <div className={styles.priceVal}>$0<span>/mo</span></div>
            <div className={styles.featureItem}>✓ 200 Edits/mo</div>
            <div className={styles.featureItem}>✓ Core Features</div>
          </div>
          <div className={`${styles.priceCard} ${styles.featured}`}>
            <h4>PRO</h4>
            <div className={styles.priceVal}>
              {billingCycle === "monthly" ? "$15" : "$150"}
              <span>{billingCycle === "monthly" ? "/mo" : "/yr"}</span>
            </div>
            {billingCycle === "yearly" ? (
              <div className={styles.discountCallout}>
                 <span className={styles.strikethrough}>$180</span> <strong>Save $30</strong> (2 months free)
              </div>
            ) : (
              <div className={styles.discountSpacer}></div>
            )}
            <div className={styles.featureItem}>✓ Unlimited Edits</div>
            <div className={styles.featureItem}>✓ Smart Rounding</div>
            <div className={styles.featureItem}>✓ Priority Support</div>
            <Link to="/auth/login" className={styles.btnWhite}>Get Started</Link>
          </div>
        </div>
      </div>
    </LandingLayout>
  );
}
