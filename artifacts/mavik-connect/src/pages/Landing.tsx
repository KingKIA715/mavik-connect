import { Link, Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Lock,
  Reply,
  Mic,
  AtSign,
  Play,
  CheckCheck,
  Video,
  Inbox,
  ShieldCheck,
  KeyRound,
  UserPlus,
  MessagesSquare,
} from "lucide-react";

export default function Landing() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/app" />;

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Sticky header doubles as in-page navigation, so the page is never
          more than one click deep no matter how far someone scrolls. */}
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-sm border-b border-border/60">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 py-4">
          <a href="#top" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="w-8 h-8 rounded-[9px]" />
            <span className="font-serif font-bold text-lg tracking-tight text-foreground">
              Mavik Connect
            </span>
          </a>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <a
              href="#features"
              className="hover:text-foreground transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hover:text-foreground transition-colors"
            >
              How it works
            </a>
            <a href="#faq" className="hover:text-foreground transition-colors">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/sign-in">
              <Button
                variant="ghost"
                className="rounded-full hidden sm:inline-flex"
              >
                Sign In
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button className="rounded-full">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        id="top"
        className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-20 sm:pb-28 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center"
      >
        <div className="space-y-6 sm:space-y-8 text-center lg:text-left animate-in fade-in slide-in-from-bottom-8 duration-700">
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/10"
          >
            Now with message requests — you decide who reaches you
          </Badge>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-foreground tracking-tight leading-[1.1]">
            A private space for the people you love.
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-lg mx-auto lg:mx-0">
            Reply to the message that started it. Send a voice note when typing
            won't cut it. Tag your sister so she doesn't miss the plan. All of
            it end‑to‑end encrypted, just for your family.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 pt-2">
            <Link href="/sign-up">
              <Button
                size="lg"
                className="w-full sm:w-auto text-base px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all"
              >
                Create a Family Group
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto text-base px-8 py-6 rounded-full"
              >
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
          <div
            className="absolute -inset-6 sm:-inset-10 bg-primary/5 rounded-[2.5rem] -z-10"
            aria-hidden="true"
          />
          <div className="max-w-sm mx-auto bg-card border border-card-border rounded-[2rem] shadow-2xl shadow-primary/10 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-sidebar">
              <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-serif font-semibold text-sm flex-shrink-0">
                O
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  The Okafors
                </div>
                <div className="text-xs text-muted-foreground">4 online</div>
              </div>
            </div>
            <div className="p-5 space-y-4 bg-background">
              {/* incoming text */}
              <div className="flex flex-col items-start max-w-[85%]">
                <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">
                  Mom
                </span>
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white border border-border text-sm shadow-sm">
                  Sunday brunch at mine — everyone free?
                </div>
              </div>
              {/* reply/quote */}
              <div className="flex flex-col items-end max-w-[85%] ml-auto">
                <div className="mb-1 max-w-full border-l-2 border-primary/40 bg-muted/40 rounded-md px-2.5 py-1.5 text-xs self-end">
                  <div className="font-medium text-primary/80">Mom</div>
                  <div className="text-muted-foreground truncate">
                    Sunday brunch at mine — everyone free?
                  </div>
                </div>
                <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-primary text-primary-foreground text-sm shadow-sm">
                  Count me in! Bringing{" "}
                  <span className="font-medium bg-white/20 rounded px-0.5">
                    @Jamie
                  </span>{" "}
                  too
                </div>
                <span className="text-[10px] text-muted-foreground/60 mt-1 px-1 flex items-center gap-1">
                  9:41 AM <CheckCheck className="w-3 h-3 text-primary/70" />
                </span>
              </div>
              {/* voice message */}
              <div className="flex flex-col items-start max-w-[85%]">
                <span className="text-xs text-muted-foreground ml-1 mb-1 font-medium">
                  Dad
                </span>
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white border border-border shadow-sm flex items-center gap-3 min-w-[180px]">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Play className="w-4 h-4 text-primary ml-0.5" />
                  </div>
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full w-2/5 bg-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    0:14
                  </span>
                </div>
              </div>
              {/* system message — a real, distinctive feature: quiet, centered, unmissable */}
              <div className="flex justify-center">
                <span className="text-[11px] text-muted-foreground bg-muted/60 px-3 py-1 rounded-full">
                  Jamie joined the group
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — a genuine sequence, so numbered steps carry real information */}
      <section
        id="how-it-works"
        className="border-t border-border/60 bg-sidebar/40"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="text-center max-w-xl mx-auto mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
              Set up in minutes, private from the first message
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 sm:gap-6">
            <Step
              number="01"
              icon={<UserPlus className="w-5 h-5" />}
              title="Create your space"
              description="Sign up and start a family group, or reach out to one person at a time — your call."
            />
            <Step
              number="02"
              icon={<Inbox className="w-5 h-5" />}
              title="Invite on your terms"
              description="Add family to a group directly, or find someone by name or email. A new DM starts as a request they can accept or decline."
            />
            <Step
              number="03"
              icon={<MessagesSquare className="w-5 h-5" />}
              title="Talk, call, and share"
              description="Text, voice notes, replies, mentions, and video calls — encrypted end-to-end the entire time."
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24"
      >
        <div className="text-center max-w-xl mx-auto mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
            Built for how families actually talk
          </h2>
          <p className="text-muted-foreground mt-3">
            Every feature below exists because a real conversation needed it.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
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
          <FeatureCard
            icon={<Inbox className="w-5 h-5" />}
            title="Message requests"
            badge="New"
            description="A DM from someone new arrives as a request. Accept it, decline it, or just leave it — they can't push more your way until you say yes."
          />
          <FeatureCard
            icon={<Video className="w-5 h-5" />}
            title="Voice & video calls"
            description="Jump from a chat straight into a call, one-on-one or with the whole group."
          />
          <FeatureCard
            icon={<KeyRound className="w-5 h-5" />}
            title="End-to-end encryption"
            description="Every message, file, and call is encrypted with keys only your own devices ever hold."
          />
        </div>
      </section>

      {/* Trust — the actual differentiator for a private/family app */}
      <section className="border-t border-border/60 bg-sidebar/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div className="space-y-4 text-center md:text-left">
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
              Private by design, not by promise
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-md mx-auto md:mx-0">
              Mavik Connect isn't funded by keeping you scrolling. There are no
              ads here, nothing to sell to a data broker, and nothing to read
              but what your family sends each other.
            </p>
          </div>
          <div className="space-y-5">
            <TrustPoint
              icon={<ShieldCheck className="w-5 h-5" />}
              title="No ads, no data mining"
              description="Your conversations are the product of nobody. There's no business model built on reading them."
            />
            <TrustPoint
              icon={<Inbox className="w-5 h-5" />}
              title="You control who can reach you"
              description="Strangers can't fill your inbox. Every new DM is a request until you accept it."
            />
            <TrustPoint
              icon={<KeyRound className="w-5 h-5" />}
              title="Keys never leave your devices"
              description="Messages are encrypted before they leave your phone or browser — not just in transit, not just at rest."
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24"
      >
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
            Questions, answered
          </h2>
        </div>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="free">
            <AccordionTrigger className="text-left font-medium">
              Is Mavik Connect free to use?
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              Yes. Creating an account, starting a family group, and messaging
              are all free.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="who-can-message">
            <AccordionTrigger className="text-left font-medium">
              Who can send me a message?
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              Anyone can find your name and send a first message — but it
              arrives as a request, not straight into your inbox. Nothing
              further comes through until you accept it, and you can decline at
              any time.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="encryption">
            <AccordionTrigger className="text-left font-medium">
              What does "end-to-end encrypted" actually mean here?
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              Every message, file, and call is encrypted on your own device
              before it's ever sent, using keys that stay on your devices. We
              can't read your conversations, and neither can anyone else.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="groups">
            <AccordionTrigger className="text-left font-medium">
              Is this only for immediate family?
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              Not at all — "family" is just what we built it for. Create a group
              for anyone: cousins, roommates, a close-knit friend group. Anyone
              in the group can see who joins or leaves, right in the
              conversation.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="lost-access">
            <AccordionTrigger className="text-left font-medium">
              What if I switch phones or clear my browser?
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              Your account and history are safe — you'll just need the other
              person (or someone else in the group) to be online briefly so your
              new device can be handed a fresh copy of the encryption key. We'll
              walk you through it if it comes up.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
            Your family's conversations deserve a private home.
          </h2>
          <Link href="/sign-up">
            <Button
              size="lg"
              className="text-base px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all"
            >
              Create a Family Group
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-5 h-5 rounded-[5px]" />
            Mavik Connect
          </div>
          <nav className="flex items-center gap-5">
            <a
              href="#features"
              className="hover:text-foreground transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hover:text-foreground transition-colors"
            >
              How it works
            </a>
            <a href="#faq" className="hover:text-foreground transition-colors">
              FAQ
            </a>
          </nav>
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
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 sm:p-7 text-center sm:text-left">
      <div className="flex items-center justify-center sm:justify-start gap-2 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        {badge && (
          <Badge className="rounded-full text-[10px] px-2 py-0.5 bg-primary text-primary-foreground hover:bg-primary">
            {badge}
          </Badge>
        )}
      </div>
      <h3 className="font-serif font-semibold text-lg text-foreground mb-1.5">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function Step({
  number,
  icon,
  title,
  description,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center sm:text-left">
      <div className="flex items-center justify-center sm:justify-start gap-3 mb-3">
        <span className="font-serif text-sm font-semibold text-primary/60 tabular-nums">
          {number}
        </span>
        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
      </div>
      <h3 className="font-serif font-semibold text-lg text-foreground mb-1.5">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function TrustPoint({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="font-medium text-foreground mb-0.5">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
