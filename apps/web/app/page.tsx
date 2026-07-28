import { ApiHealthStatus } from '@/components/api-health-status';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="project-header">
        <div className="brand-mark" aria-hidden="true">
          WQ
        </div>
        <div>
          <p className="eyebrow">Version 0 · Foundation</p>
          <h1>WashQueue KZ</h1>
          <p className="subtitle">Car wash marketplace and queue platform</p>
        </div>
      </header>

      <nav className="public-actions" aria-label="Customer account">
        <Link href="/login">Sign in</Link>
        <Link href="/register">Create account</Link>
      </nav>

      <section className="status-section" aria-labelledby="system-status-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Development environment</p>
            <h2 id="system-status-heading">System status</h2>
          </div>
          <span className="version-label">v0.0.0</span>
        </div>

        <div className="status-list">
          <div className="status-row">
            <span className="status-indicator status-indicator--success" aria-hidden="true" />
            <span>
              <strong>Frontend ready</strong>
              <small>Next.js App Router is running</small>
            </span>
          </div>
          <ApiHealthStatus />
        </div>
      </section>

      <footer>
        <p>Technical foundation only. Product capabilities begin in Version 1.</p>
      </footer>
    </main>
  );
}
