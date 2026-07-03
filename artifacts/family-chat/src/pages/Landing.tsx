import { Link, Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/app" />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="max-w-xl text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <h1 className="text-5xl md:text-7xl font-serif font-bold text-primary tracking-tight">
          Mavik Connect
        </h1>
        <p className="text-xl md:text-2xl text-muted-foreground font-sans leading-relaxed">
          A private, warm space for your family to stay close across the distance. No noise, no distractions. Just the people you love.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
          <Link href="/sign-up">
            <Button size="lg" className="w-full sm:w-auto text-lg px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all">
              Create a Family Group
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg px-8 py-6 rounded-full">
              Sign In
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
