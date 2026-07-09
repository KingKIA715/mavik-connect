import { Link, Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/app" />;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-xl text-center space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-serif font-bold text-primary tracking-tight leading-tight">
          Mavik Connect
        </h1>
        <p className="text-lg sm:text-xl md:text-2xl text-muted-foreground font-sans leading-relaxed px-2 sm:px-0">
          A private, warm space for your family to stay close across the distance. No noise, no distractions. Just the people you love.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-4 sm:pt-8">
          <Link href="/sign-up">
            <Button size="lg" className="w-full sm:w-auto text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-full shadow-lg hover:shadow-xl transition-all">
              Create a Family Group
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline" className="w-full sm:w-auto text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-full">
              Sign In
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
