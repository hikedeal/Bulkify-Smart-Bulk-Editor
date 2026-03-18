import { Link } from "react-router";
import styles from "./LandingStyles.module.css";

export default function LandingLayout({ children }) {
  return (
    <div className={styles.wrapper}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.logo}>
          <img src="/logo.png" alt="Bulkify" className={styles.logoImage} />
        </Link>
        <div className={styles.navLinks}>
          <a href="/#features" className={styles.navLink}>Features</a>
          <Link to="/pricing" className={styles.navLink}>Pricing</Link>
          <Link to="/tutorial" className={styles.navLink}>Tutorial</Link>
          <Link to="/auth/login" className={styles.navButton}>Get Started</Link>
        </div>
      </nav>
      
      <main>
        {children}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <Link to="/" className={styles.logo}>
              <img src="/logo.png" alt="Bulkify" className={styles.logoImage} />
            </Link>
            <p>Empowering Shopify merchants with smarter data tools.</p>
          </div>
          <div className={styles.footerCol}>
            <h4>Product</h4>
            <ul>
              <li><Link to="/pricing">Pricing</Link></li>
              <li><Link to="/tutorial">Tutorial</Link></li>
              <li><Link to="/changelog">Chchangelog</Link></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Support</h4>
            <ul>
              <li><Link to="/faq">FAQ</Link></li>
              <li><Link to="/privacy">Privacy Policy</Link></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Legal</h4>
            <ul>
              <li><Link to="/privacy">Privacy</Link></li>
              <li><Link to="/terms">Terms</Link></li>
            </ul>
          </div>
        </div>
        <div className={styles.copyright}>
          &copy; 2026 Bulkify Inc. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
