export default function DevelopersPage() {
  return (
    <div className="mgr-card">
      <h2>API keys</h2>
      <p className="mgr-empty">
        There&apos;s no public API and no customer-facing keys. The only credential is the Supabase service key, which
        lives server-side in environment variables and is never exposed to the browser. If you want a public API for
        integrations, that&apos;s a project to scope together.
      </p>
    </div>
  );
}
