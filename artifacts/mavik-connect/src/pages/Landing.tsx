import { Link, Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Lock, Reply, Mic, AtSign, Play, CheckCheck } from "lucide-react";

export default function Landing() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/app" />;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 py-5">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="w-8 h-8 rounded-[9px]" />
          <span className="font-serif font-bold text-lg tracking-tight text-foreground">Mavik Connect</span>
        </div>
        <Link href="/sign-in">
          <Button variant="ghost" className="rounded-full">
            Sign In
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-20 sm:pb-28 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div className="space-y-6 sm:space-y-8 text-center lg:text-left animate-in fade-in slide-in-from-bottom-8 duration-700">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-foreground tracking-tight leading-[1.1]">
            A private space for the people you love.
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-lg mx-auto lg:mx-0">
            Reply to the message that started it. Send a voice note when typing won't cut it. Tag your sister so she doesn't miss the plan. All of it end‑to‑end encrypted, just for your family.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 pt-2">
            <Link href="/sign-up">
              <Button size="lg" className="w-full sm:w-auto text-base px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all">
                Create a Family Group
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 py-6 rounded-full">
                Sign In
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-center lg:justify-start gap-2 text-sm text-muted-foreground pt-1">
            <Lock className="w-3.5 h-3.5" />
            End-to-end encrypted — no one but your family can read a word.
          </div>
        </div>

        {/* Signature element: a live mock conversation showing reply, voice, and mentions */}
        <div className="relative animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-150">
          <div className="absolute -inset-6 sm:-inset-10 bg-primary/5 rounded-[2.5rem] -z-10" aria-hidden="true" />
          <div className="max-w-sm mx-auto bg-card border border-card-border rounded-[2rem] shadow-2xl shadow-primary/10 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-sidebar">
              <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-serif font-semibold text-sm flex-shrink-0">
                O
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">The Okafors</div>
                <div className="text-xs text-muted-foreground">4 online</div>
              </div>
            </div>
            <div className="p-5 space-y-4 bg-background">
              {/* incoming text */}
              <div className="flex flex-col items-start max-w-[85%]">
                <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">Mom</span>
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white border border-border text-sm shadow-sm">
                  Sunday brunch at mine — everyone free?
                </div>
              </div>
              {/* reply/quote */}
              <div className="flex flex-col items-end max-w-[85%] ml-auto">
                <div className="mb-1 max-w-full border-l-2 border-primary/40 bg-muted/40 rounded-md px-2.5 py-1.5 text-xs self-end">
                  <div className="font-medium text-primary/80">Mom</div>
                  <div className="text-muted-foreground truncate">Sunday brunch at mine — everyone free?</div>
                </div>
                <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-primary text-primary-foreground text-sm shadow-sm">
                  Count me in! Bringing{" "}
                  <span className="font-medium bg-white/20 rounded px-0.5">@Jamie</span> too
                </div>
                <span className="text-[10px] text-muted-foreground/60 mt-1 px-1 flex items-center gap-1">
                  9:41 AM <CheckCheck className="w-3 h-3 text-primary/70" />
                </span>
              </div>
              {/* voice message */}
              <div className="flex flex-col items-start max-w-[85%]">
                <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">Dad</span>
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white border border-border shadow-sm flex items-center gap-3 min-w-[180px]">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Play className="w-4 h-4 text-primary ml-0.5" />
                  </div>
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full w-2/5 bg-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">0:14</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 sm:pb-28">
        <div className="text-center max-w-xl mx-auto mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
            Built for how families actually talk
          </h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-6 sm:gap-8">
          <FeatureCard
            icon={<Reply className="w-5 h-5" />}
            title="Reply & quote"
            description="Answer the exact message you mean, so nobody loses the thread in a busy group chat."
          />
          <FeatureCard
            icon={<Mic className="w-5 h-5" />}
            title="Voice messages"
            description="Record a quick note when a call is too much and a text isn't enough."
          />
          <FeatureCard
            icon={<AtSign className="w-5 h-5" />}
            title="@Mentions"
            description="Tag someone by name and they'll know it's meant for them, even in a big family group."
          />
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-5 h-5 rounded-[5px]" />
            Mavik Connect
          </div>
          <div className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Private and end-to-end encrypted
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 sm:p-7 text-center sm:text-left">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 mx-auto sm:mx-0">
        {icon}
      </div>
      <h3 className="font-serif font-semibold text-lg text-foreground mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
