import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, useUser, SignOutButton } from "@clerk/react";
import { ReactNode } from "react";
import { LogOut, Settings, MessageCircle, Home, Menu, X } from "lucide-react";
import { EncryptionProvider } from "@/hooks/use-encryption";
import { useOfflineOutboxFlush } from "@/hooks/use-offline-outbox";
import { RecoveryPhraseModal } from "@/components/RecoveryPhraseModal";

export function AppLayout({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useOfflineOutboxFlush();

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  const navItems = (
    <>
      <Link
        href="/app"
        onClick={() => setMobileMenuOpen(false)}
        className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${location === "/app" ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
      >
        <Home className="w-5 h-5" />
        Chats
      </Link>
    </>
  );

  return (
    <EncryptionProvider>
      <RecoveryPhraseModal />
      <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex w-64 border-r border-border bg-sidebar flex-col">
          <div className="p-4 border-b border-sidebar-border">
            <Link href="/app" className="flex items-center gap-2 text-sidebar-primary font-serif font-bold text-xl">
              <MessageCircle className="w-6 h-6" />
              <span>Mavik Connect</span>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
            {navItems}
          </nav>

          <div className="p-4 border-t border-sidebar-border space-y-2">
            {user && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground">
                <img
                  src={user.imageUrl}
                  alt=""
                  className="w-6 h-6 rounded-full"
                />
                <span className="truncate">{user.firstName || user.username || "User"}</span>
              </div>
            )}
            <Link
              href="/app/settings"
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            >
              <Settings className="w-5 h-5" />
              Settings
            </Link>

            <SignOutButton>
              <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-destructive hover:bg-destructive/10 transition-colors">
                <LogOut className="w-5 h-5" />
                Sign Out
              </button>
            </SignOutButton>
          </div>
        </aside>

        {/* Mobile Top Bar */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b border-border">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/app" className="flex items-center gap-2 text-primary font-serif font-bold text-lg">
              <MessageCircle className="w-5 h-5" />
              <span>Mavik Connect</span>
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Mobile Menu Dropdown */}
          {mobileMenuOpen && (
            <div className="border-t border-border bg-background px-4 py-3 space-y-1">
              {navItems}
              <Link
                href="/app/settings"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-foreground hover:bg-muted transition-colors"
              >
                <Settings className="w-5 h-5" />
                Settings
              </Link>
              <SignOutButton>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-destructive hover:bg-destructive/10 transition-colors">
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </button>
              </SignOutButton>
            </div>
          )}
        </div>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative overflow-hidden bg-background pt-[57px] md:pt-0">
          {children}
        </main>
      </div>
    </EncryptionProvider>
  );
}
