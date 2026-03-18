import LandingLayout from "../components/LandingLayout";
import styles from "./_index/styles.module.css";

export default function TutorialPage() {
  return (
    <LandingLayout>
      <div className={styles.steps} style={{ padding: '10rem 5%' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '4rem' }}>Master Bulkify in minutes</h1>
        <div className={styles.stepGrid} style={{ textAlign: 'left' }}>
          <div className={styles.stepItem}><span className={styles.stepNum}>01</span><h3>Installation</h3><p>Install Bulkify from the Shopify App Store. Your product catalog will sync automatically in the background.</p></div>
          <div className={styles.stepItem}><span className={styles.stepNum}>02</span><h3>Creating a Task</h3><p>Go to "New Task", pick the field you want to edit (e.g. Price), and set your filters to target specific products.</p></div>
          <div className={styles.stepItem}><span className={styles.stepNum}>03</span><h3>Review & Run</h3><p>Preview your changes in the side drawer. If it looks good, hit "Run Task" and watch the magic happen.</p></div>
        </div>
        <div style={{ marginTop: '6rem', background: '#fff', padding: '4rem', borderRadius: '32px', border: '1px solid #e2e8f0', textAlign: 'left', maxWidth: '1100px', margin: '6rem auto 0' }}>
           <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Pro Tip: Use Tagging</h3>
           <p style={{ color: '#64748b' }}>Combine "Tag Architect" with "Price Editor" to run complex seasonal sales across multiple collections simultaneously.</p>
        </div>
      </div>
    </LandingLayout>
  );
}
