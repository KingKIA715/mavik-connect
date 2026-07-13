import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/Layout";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Settings from "@/pages/Settings";
import ChatRoom from "@/pages/ChatRoom";
import VideoCall from "@/pages/VideoCall";
import DmInbox from "@/pages/DmInbox";
import DmThread from "@/pages/DmThread";

const queryClient = new QueryClient();

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains. Do not inline the env var, leave
// publishableKey undefined, or replace publishableKeyFromHost with anything else.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev (Clerk hits dev FAPI directly), auto-set
// in prod. Do NOT gate on import.meta.env.PROD / NODE_ENV — the empty dev value
// is intentional, and any branching breaks the prod proxy.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function ProtectedRoute({ component: Component }: { component: any }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="min-h-screen bg-background" />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <Component />;
}

function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Landing} />

        {/* REQUIRED — copy "/sign-in/*?" and "/sign-up/*?" verbatim. The /*? optional
            wildcard is the only wouter syntax that matches both the bare URL and Clerk's
            OAuth sub-paths. Not /sign-in, not /sign-in/*, not /sign-in/:rest*. */}
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />

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

        <Route path="/app/dms">
          <ProtectedRoute component={DmInbox} />
        </Route>

        <Route path="/app/dms/:threadId">
          <ProtectedRoute component={DmThread} />
        </Route>

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
