import { Link } from "@remix-run/react";
import styles from "./styles.module.css";
import LandingLayout from "../components/LandingLayout";

export default function Index() {
  return (
    <LandingLayout>
      <div className={styles.index}>
        
        {/* HERO SECTION */}
        <section className={styles.hero}>
          <div className={styles.heroGlow}></div>
          <div className={styles.badge}>✨ The New Standard for Shopify</div>
          <h1 className={styles.heroTitle}>
            Turn store updates into <span className={styles.highlight}>growth</span>
          </h1>
          <p className={styles.heroSubtitle}>
            The smartest bulk editor for Shopify. Manage prices, inventory, tags and metafields at total scale without the fear of making mistakes.
          </p>
          <div className={styles.heroCTA}>
            <Link to="/auth/login" className={styles.btnRed}>Start Free Trial</Link>
            <Link to="/auth/login" className={styles.btnOutline}>Book a Demo</Link>
          </div>

          {/* HERO APP PREVIEW */}
          <div className={styles.heroPreviewWindow}>
            <div className={styles.previewHeader}>
              <div className={styles.trafficLights}>
                <span></span><span></span><span></span>
              </div>
              <div className={styles.urlBar}>bulkify.co/dashboard</div>
            </div>
            <div className={styles.previewContent}>
              <div className={styles.mockSidebar}>
                 <div className={styles.mockBone}></div>
                 <div className={styles.mockBone}></div>
                 <div className={styles.mockBone}></div>
              </div>
              <div className={styles.mockMain}>
                 <div className={styles.mockHeader}>
                   <h2>Task Dashboard</h2>
                   <div className={styles.mockAvatar}></div>
                 </div>
                 <div className={styles.mockTable}>
                    <div className={styles.mockRow}></div>
                    <div className={styles.mockRow}></div>
                    <div className={styles.mockRow}></div>
                    <div className={styles.mockRow}></div>
                 </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUSTED BY (SOCIAL PROOF) */}
        <section className={styles.trusted}>
          <p>Trusted by hyper-growth Shopify Plus brands</p>
          <div className={styles.logoGrid}>
            <span className={styles.brandLogo}>Gymshark</span>
            <span className={styles.brandLogo}>Allbirds</span>
            <span className={styles.brandLogo}>FashionNova</span>
            <span className={styles.brandLogo}>KylieCosmetics</span>
            <span className={styles.brandLogo}>MVMT</span>
          </div>
        </section>

        {/* 10 POWER FEATURES GRID */}
        <section id="features" className={styles.featuresSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>CAPABILITIES</span>
            <h2 className={styles.sectionTitle}>Everything you need to scale</h2>
            <p className={styles.sectionSubtitle}>Ten dedicated, laser-focused tools to manage your entire catalog.</p>
          </div>
          <div className={styles.featureGrid}>
            <div className={styles.featureCard}><h3>💰 Update Prices</h3><p>Adjust product prices in bulk by percentage or flat amounts.</p></div>
            <div className={styles.featureCard}><h3>🏷️ Compare Price</h3><p>Manage "compare at" prices to run irresistible storewide sales.</p></div>
            <div className={styles.featureCard}><h3>🚦 Product Status</h3><p>Securely publish, draft, or archive products at total scale.</p></div>
            <div className={styles.featureCard}><h3>📦 Sync Inventory</h3><p>Keep stock levels ruthlessly accurate across multiple locations.</p></div>
            <div className={styles.featureCard}><h3>📂 Manage Tags</h3><p>Add, remove, or replace tags to organize your catalog quickly.</p></div>
            <div className={styles.featureCard}><h3>👕 Product Type</h3><p>Reclassify hundreds of items into the correct category instantly.</p></div>
            <div className={styles.featureCard}><h3>🏭 Change Vendor</h3><p>Shift suppliers or brand mappings across your catalog in seconds.</p></div>
            <div className={styles.featureCard}><h3>⚖️ Edit Weight</h3><p>Fix shipping calculation issues by standardizing product weights.</p></div>
            <div className={styles.featureCard}><h3>🧾 Tax Settings</h3><p>Ensure tax compliance by toggling taxable status in bulk.</p></div>
            <div className={styles.featureCard}><h3>⚡ Metafields</h3><p>Unlock custom data control for advanced storefront SEO.</p></div>
          </div>
        </section>

        {/* DEEP DIVE ALTERNATING SECTIONS */}
        <section className={styles.deepDiveSection}>
           <div className={styles.alternatingRow}>
              <div className={styles.alternatingText}>
                 <span className={styles.featurePill}>Smart Logic</span>
                 <h3>Intelligent Smart Pricing</h3>
                 <p>Don't just change prices blindly. Use our smart rounding engine to automatically turn messy calculations like $19.43 into clean, converted numbers like $19.99 across thousands of variants.</p>
                 <ul className={styles.featureChecklist}>
                   <li>✅ Bulk Margin Adjustments</li>
                   <li>✅ Smart Cent Rounding (e.g. .99 or .95)</li>
                   <li>✅ Total Compare-at Price automation</li>
                 </ul>
              </div>
              <div className={styles.alternatingVisual}>
                 <div className={styles.glowBox}>
                    <p className={styles.strikeText}>$19.43</p>
                    <p className={styles.newPrice}>$19.99</p>
                 </div>
              </div>
           </div>

           <div className={`${styles.alternatingRow} ${styles.reverse}`}>
              <div className={styles.alternatingText}>
                 <span className={styles.featurePill}>Peace of Mind</span>
                 <h3>Safe & Reversible Edits</h3>
                 <p>Made a mistake on Black Friday? No problem. Every task is heavily versioned, securely backed up to the cloud, and can be instantly reversed with a single click.</p>
                 <ul className={styles.featureChecklist}>
                   <li>✅ 30-Day Change History</li>
                   <li>✅ 1-Click Secure Rollbacks</li>
                   <li>✅ Pre-flight Error Validations</li>
                 </ul>
              </div>
              <div className={styles.alternatingVisual}>
                 <div className={styles.glowBox}>
                    <div className={styles.rollbackUi}>
                       <span className={styles.timeIcon}>⏱️</span>
                       <div className={styles.rollbackDetails}>
                         <strong>Revert Task #4922</strong>
                         <span>Restoring 4,203 prices...</span>
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </section>

        {/* TESTIMONIALS */}
        <section className={styles.testimonials}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>SOCIAL PROOF</span>
            <h2 className={styles.sectionTitle}>Merchants love Bulkify</h2>
          </div>
          <div className={styles.testimonialGrid}>
            <div className={styles.testimonialCard}>
              <div className={styles.stars}>⭐⭐⭐⭐⭐</div>
              <p>"Saved us literally 40 hours of manual work during Black Friday. The UI is incredibly fast and intuitive. Best ROI we've spent this year."</p>
              <h4>Sarah J. <span className={styles.founderTitle}>Founder at Elevate</span></h4>
            </div>
            <div className={styles.testimonialCard}>
               <div className={styles.stars}>⭐⭐⭐⭐⭐</div>
               <p>"I've tried 5 different bulk editors. This is the only one that handles our 20,000+ SKU catalog without crashing or skipping variants."</p>
               <h4>Mike T. <span className={styles.founderTitle}>Ecom Director</span></h4>
            </div>
            <div className={styles.testimonialCard}>
               <div className={styles.stars}>⭐⭐⭐⭐⭐</div>
               <p>"The smart pricing rounding paid for itself in a single day. It's an absolute must-have app for any serious scaling store."</p>
               <h4>Jessica R. <span className={styles.founderTitle}>Brand Manager</span></h4>
            </div>
          </div>
        </section>

        {/* PRICING PREVIEW */}
        <section className={styles.pricingPreview}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>PRICING</span>
            <h2 className={styles.sectionTitle}>Simple, transparent pricing</h2>
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
              <div className={styles.priceVal}>$15<span>/mo</span></div>
              <div className={styles.featureItem}>✓ Unlimited Edits</div>
              <div className={styles.featureItem}>✓ Smart Rounding</div>
              <div className={styles.featureItem}>✓ Priority Support</div>
              <Link to="/auth/login" className={styles.btnWhite}>Get Started</Link>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className={styles.finalCta}>
          <h2>Ready to unlock your catalog's potential?</h2>
          <p>Join thousands of growing Shopify brands today.</p>
          <Link to="/auth/login" className={styles.btnRed}>Install Bulkify Free</Link>
        </section>

      </div>
    </LandingLayout>
  );
}
