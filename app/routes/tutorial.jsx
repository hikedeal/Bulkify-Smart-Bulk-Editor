import LandingLayout from "../components/LandingLayout";
import styles from "./_index/styles.module.css";
import { Link } from "react-router";

export default function TutorialPage() {
  return (
    <LandingLayout>
      <div className={styles.index}>
        <section className={styles.featuresSection} style={{ paddingTop: "12rem", minHeight: "80vh" }}>
          
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>TUTORIAL</span>
            <h2 className={styles.sectionTitle}>Master Bulkify in minutes</h2>
            <p className={styles.sectionSubtitle}>Follow these three simple steps to safely run your first bulk automation.</p>
          </div>
          
          <div className={styles.featureGrid} style={{ marginTop: "4rem" }}>
            <div className={styles.featureCard}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem", color: "var(--primary)", fontWeight: "800" }}>01</div>
              <h3 style={{ marginBottom: "0.5rem" }}>🚀 Installation</h3>
              <p>Install Bulkify securely. Your products sync automatically in the background without impacting your live store speed.</p>
            </div>
            
            <div className={styles.featureCard}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem", color: "var(--primary)", fontWeight: "800" }}>02</div>
              <h3 style={{ marginBottom: "0.5rem" }}>⚙️ Create a Task</h3>
              <p>Click "New Task", isolate the parameters you want to edit (e.g., Price), and apply intelligent conditions to target specifically.</p>
            </div>
            
            <div className={styles.featureCard}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem", color: "var(--primary)", fontWeight: "800" }}>03</div>
              <h3 style={{ marginBottom: "0.5rem" }}>✨ Review & Run</h3>
              <p>Evaluate exact line-by-line staging changes. If they look flawless, deploy the task and watch the engine securely operate.</p>
            </div>
          </div>

          <div style={{
            marginTop: '5rem',
            background: 'var(--surface)',
            padding: '4rem',
            borderRadius: '24px',
            border: '1px solid var(--border-strong)',
            maxWidth: '900px',
            margin: '5rem auto 0',
            textAlign: 'center',
            boxShadow: 'var(--shadow-md)'
          }}>
             <span className={styles.sectionLabel} style={{ marginBottom: "1rem", display: "inline-block" }}>💡 PRO TIP</span>
             <h3 style={{ fontSize: '1.75rem', marginBottom: '1rem', color: 'var(--text-main)', fontWeight: "800" }}>Combine Actions Powerfully</h3>
             <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto 2rem' }}>
               You can stack bulk updates efficiently. For instance, tag multiple products as "Clearance" while simultaneously slashing their target prices by 30% inside a single unified execution.
             </p>
             <Link to="/auth/login" className={styles.btnRed}>Deploy Your First Task</Link>
          </div>

        </section>
      </div>
    </LandingLayout>
  );
}
