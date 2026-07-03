import { Link, useLocation } from "wouter";
import { useAuth, useUser, SignOutButton } from "@clerk/react";
import { ReactNode } from "react";
import { LogOut, Settings, MessageCircle, Home } from "lucide-react";
import { EncryptionProvider } from "@/hooks/use-encryption";

export function AppLayout({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [location] = useLocation();

  if (!isLoaded) return null;
  
  if (!isSignedIn) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  return (
    <EncryptionProvider>
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <Link href="/app" className="flex items-center gap-2 text-sidebar-primary font-serif font-bold text-xl">
            <MessageCircle className="w-6 h-6" />
            <span>Mavik Connect</span>
          </Link>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          <Link href="/app" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${location === "/app" ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
            <Home className="w-5 h-5" />
            Dashboard
          </Link>
        </nav>
        
        <div className="p-4 border-t border-sidebar-border space-y-2">
          <Link href="/app/settings" className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors">
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

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        {children}
      </main>
    </div>
    </EncryptionProvider>
  );
}
