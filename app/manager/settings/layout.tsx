import SettingsNav from "@/components/manager/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mgr-page-title">Settings</h1>
      <div className="rpt-layout">
        <SettingsNav />
        <div>{children}</div>
      </div>
    </>
  );
}
