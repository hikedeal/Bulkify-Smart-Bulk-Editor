import LandingLayout from "../components/LandingLayout";
import styles from "../components/LandingStyles.module.css";

export default function Changelog() {
  return (
    <LandingLayout>
      <div className={styles.legalContent}>
        <h1>Changelog</h1>
        <p>The latest updates and improvements to Bulkify.</p>
        
        <h2>March 2026 - Premium Experience</h2>
        <p>🚀 <strong>Complete Redesign:</strong> Launched a stunning new landing page and brand identity.</p>
        <p>⚡ <strong>Performance Boost:</strong> Optimized GraphQL batching for faster large-scale catalog updates.</p>
        <p>🛡️ <strong>Safety+:</strong> Improved our revert system to handle complex inventory scenarios across multiple locations.</p>
      </div>
    </LandingLayout>
  );
}
