import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth } from "@clerk/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/Layout";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Settings from "@/pages/Settings";
import ChatRoom from "@/pages/ChatRoom";
import VideoCall from "@/pages/VideoCall";

const queryClient = new QueryClient();

// In Replit, use the proxy or publishable key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_placeholder";

function ProtectedRoute({ component: Component }: { component: any }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="min-h-screen bg-background" />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <Component />;
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Landing} />
        
        <Route path="/sign-in">
          <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <SignIn routing="hash" />
          </div>
        </Route>
        
        <Route path="/sign-up">
          <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <SignUp routing="hash" />
          </div>
        </Route>

        <Route path="/app">
          <ProtectedRoute component={Dashboard} />
        </Route>

        <Route path="/app/settings">
          <ProtectedRoute component={Settings} />
        </Route>

        <Route path="/app/groups/:groupId">
          <ProtectedRoute component={ChatRoom} />
        </Route>

        <Route path="/app/groups/:groupId/call">
          <ProtectedRoute component={VideoCall} />
        </Route>

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
