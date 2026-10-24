import { AppSidebar } from "@/components/layout/app-sidebar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
