import * as React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  Calendar,
  ClipboardList,
  FileText,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
  Sparkles,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "../stores/auth.store";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import type { UserRole } from "../types/auth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

function getNavigationItemsForRole(role?: UserRole): NavItem[] {
  switch (role) {
    case "PATIENT":
      return [
        { label: "Dashboard", href: "/patient/dashboard", icon: LayoutDashboard },
        { label: "Find Doctors", href: "/patient/doctors", icon: Stethoscope },
        { label: "Appointments", href: "/patient/appointments", icon: Calendar },
        { label: "Medical Records", href: "/patient/medical-records", icon: FileText },
        { label: "Medicine Orders", href: "/patient/orders", icon: Pill },
        { label: "AI Health Navigator", href: "/patient/ai-assistant", icon: Sparkles },
      ];
    case "DOCTOR":
      return [
        { label: "Dashboard", href: "/doctor/dashboard", icon: LayoutDashboard },
        { label: "My Schedule", href: "/doctor/schedule", icon: Calendar },
        { label: "Appointments", href: "/doctor/appointments", icon: ClipboardList },
        { label: "Consultation History", href: "/doctor/consultations", icon: Stethoscope },
        { label: "Doctor Analytics", href: "/doctor/analytics", icon: BarChart3 },
      ];
    case "PHARMACY":
      return [
        { label: "Dashboard", href: "/pharmacy/dashboard", icon: LayoutDashboard },
        { label: "Order Intake Queue", href: "/pharmacy/orders", icon: ClipboardList },
        { label: "Drug Inventory", href: "/pharmacy/inventory", icon: Pill },
        { label: "Sales Analytics", href: "/pharmacy/analytics", icon: BarChart3 },
      ];
    case "ADMIN":
      return [
        { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
        { label: "Provider Verification", href: "/admin/verifications", icon: FileCheck2 },
        { label: "Dispute Center", href: "/admin/complaints", icon: AlertTriangle },
        { label: "User Directory", href: "/admin/users", icon: Users },
        { label: "Audit Logs", href: "/admin/audit-logs", icon: ShieldCheck },
        { label: "Platform Analytics", href: "/admin/analytics", icon: BarChart3 },
      ];
    default:
      return [{ label: "Overview", href: "/", icon: LayoutDashboard }];
  }
}

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const navItems = getNavigationItemsForRole(user?.role);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased">
      {/* Accessible Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-primary focus:text-primary-foreground focus:rounded-md m-2"
      >
        Skip to main content
      </a>

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>

            <NavLink to="/" className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                <Activity className="size-5" />
              </div>
              <span className="text-foreground">LifeLine</span>
            </NavLink>
          </div>

          {/* Right Header: User Identity & Actions */}
          <div className="flex items-center gap-3 sm:gap-4">
            {user && (
              <div className="flex items-center gap-2.5">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-sm font-medium leading-none text-foreground">
                    {user.fullName || user.email}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5">{user.email}</span>
                </div>
                <Badge
                  variant={
                    (user.role?.toLowerCase() as "patient" | "doctor" | "pharmacy" | "admin") ||
                    "default"
                  }
                  className="uppercase font-semibold tracking-wider text-[10px]"
                >
                  {user.role}
                </Badge>
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              aria-label="Log out of LifeLine"
            >
              <LogOut className="size-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Shell Layout (Sidebar + Content) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar Navigation */}
        <aside
          className="hidden lg:flex w-64 flex-col border-r border-border bg-sidebar p-4 shrink-0"
          aria-label="Main sidebar navigation"
        >
          <div className="mb-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {user?.role ? `${user.role} Portal` : "Navigation"}
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            {/* Drawer */}
            <div className="relative w-4/5 max-w-xs bg-background p-6 flex flex-col shadow-xl z-10">
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Activity className="size-5 text-primary" />
                  <span className="font-bold text-foreground">Menu</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>

              <nav className="mt-4 space-y-1 flex-1 overflow-y-auto">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.href}
                      to={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </nav>

              <div className="pt-4 border-t border-border mt-auto">
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={handleLogout}
                >
                  <LogOut className="size-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Main Routed Content Area */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 outline-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
