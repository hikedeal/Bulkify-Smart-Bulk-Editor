import LandingLayout from "../components/LandingLayout";
import styles from "../components/LandingStyles.module.css";

export default function Terms() {
  return (
    <LandingLayout>
      <div className={styles.legalContent}>
        <h1>Terms of Service</h1>
        <p>By using Bulkify, you agree to the following terms.</p>
        
        <h2>1. Service Scope</h2>
        <p>Bulkify is a tool for modifying Shopify store data. While we provide a revert system, users are responsible for verifying their changes before execution.</p>

        <h2>2. Usage Limits</h2>
        <p>We do not impose hard limits on catalog size, but we reserve the right to throttle extremely large operations to maintain system stability for all users.</p>

        <h2>3. Liability</h2>
        <p>Bulkify is provided "as-is". We are not liable for any loss of revenue resulting from incorrect bulk edits made by the user.</p>
      </div>
    </LandingLayout>
  );
}
