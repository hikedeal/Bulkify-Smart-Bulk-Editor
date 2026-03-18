import LandingLayout from "../components/LandingLayout";
import styles from "../components/LandingStyles.module.css";

export default function Privacy() {
  return (
    <LandingLayout>
      <div className={styles.legalContent}>
        <h1>Privacy Policy</h1>
        <p>Your privacy is our priority. This policy outlines how we handle your store data.</p>
        
        <h2>1. Information We Collect</h2>
        <p>Bulkify accesses your Shopify store data (products, inventory, metafields) solely to perform the bulk operations you request. We do not sell or share your data with third parties.</p>

        <h2>2. Data Usage</h2>
        <p>We use your data to generate previews, execute updates, and maintain a history for our 1-click revert system. This data is encrypted and stored securely.</p>

        <h2>3. Your Rights</h2>
        <p>You can uninstall Bulkify at any time. Upon uninstallation, we retain basic task history for logs (as required by Shopify GDRE policies) but cease all active data fetching.</p>
      </div>
    </LandingLayout>
  );
}
