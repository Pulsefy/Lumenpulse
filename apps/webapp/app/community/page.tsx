"use client";

import Link from "next/link";
import {
  Github,
  Twitter,
  MessageSquare,
  GitPullRequest,
  BookOpen,
  Code2,
  Cpu,
  Smartphone,
  ExternalLink,
  ArrowRight,
  Star,
  GitFork,
  Bug,
  Lightbulb,
  CheckCircle2,
} from "lucide-react";

const CHANNELS = [
  {
    icon: Github,
    label: "GitHub",
    description: "Browse issues, submit PRs, and review code.",
    href: "https://github.com/Pulsefy/LumenPulse",
    color: "text-white",
    bg: "bg-white/5 hover:bg-white/10",
  },
  {
    icon: Twitter,
    label: "Twitter / X",
    description:
      "Follow for releases, ecosystem news, and community highlights.",
    href: "https://twitter.com",
    color: "text-sky-400",
    bg: "bg-sky-400/5 hover:bg-sky-400/10",
  },
  {
    icon: MessageSquare,
    label: "Discord",
    description: "Real-time chat with contributors and maintainers.",
    href: "https://discord.com",
    color: "text-indigo-400",
    bg: "bg-indigo-400/5 hover:bg-indigo-400/10",
  },
];

const AREAS = [
  {
    icon: Code2,
    label: "Frontend (webapp)",
    stack: "Next.js 15 · React 18 · TypeScript · Tailwind",
    guide: "document/mobile-contributing.md",
    color: "text-pink-400",
  },
  {
    icon: Cpu,
    label: "Backend (API)",
    stack: "NestJS · TypeORM · PostgreSQL · Redis",
    guide: "document/backend-contributing.md",
    color: "text-purple-400",
  },
  {
    icon: GitFork,
    label: "Smart Contracts (onchain)",
    stack: "Rust · Soroban · Stellar SDK",
    guide: "document/contracts-contributing.md",
    color: "text-blue-400",
  },
  {
    icon: Smartphone,
    label: "Mobile",
    stack: "React Native · Expo · TypeScript",
    guide: "document/mobile-contributing.md",
    color: "text-emerald-400",
  },
];

const STEPS = [
  {
    icon: Bug,
    title: "Find or open an issue",
    body: "Look for unassigned issues or confirm assignment before starting. Include context, expected behavior, and acceptance criteria when opening new ones.",
  },
  {
    icon: GitFork,
    title: "Fork, sync, and branch",
    body: "Sync your fork with main, then create a branch using feat/, fix/, or docs/ prefixes.",
  },
  {
    icon: Code2,
    title: "Implement and validate",
    body: "Keep scope aligned to the issue. Run lint and tests for every affected area before pushing.",
  },
  {
    icon: GitPullRequest,
    title: "Open a Pull Request",
    body: "Target main, link the issue with Closes #number, and attach screenshots for any UI changes.",
  },
  {
    icon: CheckCircle2,
    title: "Address review feedback",
    body: "Reply to each thread with what changed. Re-run lint/tests after updates and keep your branch up to date.",
  },
];

const ISSUE_TYPES = [
  {
    icon: Star,
    label: "Good First Issues",
    description:
      "Ideal for new contributors — well-scoped with clear acceptance criteria.",
    href: "https://github.com/Pulsefy/LumenPulse/issues?q=is%3Aopen+label%3A%22good+first+issue%22",
    color: "text-yellow-400",
    border: "border-yellow-400/20 hover:border-yellow-400/40",
  },
  {
    icon: Lightbulb,
    label: "Feature Requests",
    description: "Help shape the roadmap by picking up open feature proposals.",
    href: "https://github.com/Pulsefy/LumenPulse/issues?q=is%3Aopen+label%3Aenhancement",
    color: "text-pink-400",
    border: "border-pink-400/20 hover:border-pink-400/40",
  },
  {
    icon: Bug,
    label: "Bug Reports",
    description: "Fix confirmed bugs and improve platform stability.",
    href: "https://github.com/Pulsefy/LumenPulse/issues?q=is%3Aopen+label%3Abug",
    color: "text-red-400",
    border: "border-red-400/20 hover:border-red-400/40",
  },
  {
    icon: BookOpen,
    label: "Docs & Guides",
    description:
      "Improve READMEs, contributing guides, and inline documentation.",
    href: "https://github.com/Pulsefy/LumenPulse/issues?q=is%3Aopen+label%3Adocumentation",
    color: "text-blue-400",
    border: "border-blue-400/20 hover:border-blue-400/40",
  },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="relative pt-32 pb-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Open Source · Community Driven
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-heading tracking-tight mb-4">
            Build LumenPulse{" "}
            <span className="bg-gradient-to-r from-primary via-purple-400 to-pink-400 bg-clip-text text-transparent">
              with us
            </span>
          </h1>
          <p className="text-foreground/60 text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            LumenPulse is an open-source, community-driven platform. Whether you
            write Rust contracts, build React UIs, or improve docs — there is a
            place for you here.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="https://github.com/Pulsefy/LumenPulse"
              target="_blank"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-sm font-medium"
            >
              <Github className="w-4 h-4" />
              View on GitHub
              <ExternalLink className="w-3 h-3 opacity-60" />
            </Link>
            <Link
              href="https://github.com/Pulsefy/LumenPulse/issues?q=is%3Aopen+label%3A%22good+first+issue%22"
              target="_blank"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30 hover:bg-yellow-400/20 transition-colors text-sm font-medium text-yellow-400"
            >
              <Star className="w-4 h-4" />
              Good First Issues
            </Link>
          </div>
        </div>
      </section>

      {/* Community Channels */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold mb-2">Community Channels</h2>
          <p className="text-foreground/50 text-sm mb-8">
            Where contributors hang out, ask questions, and share updates.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CHANNELS.map(
              ({ icon: Icon, label, description, href, color, bg }) => (
                <Link
                  key={label}
                  href={href}
                  target="_blank"
                  className={`flex flex-col gap-3 p-5 rounded-xl border border-white/5 ${bg} transition-all group`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`w-5 h-5 ${color}`} />
                    <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/60 group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{label}</p>
                    <p className="text-foreground/50 text-xs mt-1 leading-relaxed">
                      {description}
                    </p>
                  </div>
                </Link>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Where to Contribute */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold mb-2">Where to Contribute</h2>
          <p className="text-foreground/50 text-sm mb-8">
            Pick an area that matches your skills. Each has its own guide.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {AREAS.map(({ icon: Icon, label, stack, guide, color }) => (
              <Link
                key={label}
                href={`https://github.com/Pulsefy/LumenPulse/blob/main/${guide}`}
                target="_blank"
                className="flex items-start gap-4 p-5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
              >
                <div className={`mt-0.5 p-2 rounded-lg bg-white/5 ${color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-foreground/40 text-xs mt-1 font-mono">
                    {stack}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/60 group-hover:translate-x-0.5 transition-all mt-0.5 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Open Issues */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold mb-2">
            Find Something to Work On
          </h2>
          <p className="text-foreground/50 text-sm mb-8">
            Browse open issues by type. Confirm assignment before starting.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ISSUE_TYPES.map(
              ({ icon: Icon, label, description, href, color, border }) => (
                <Link
                  key={label}
                  href={href}
                  target="_blank"
                  className={`flex items-start gap-4 p-5 rounded-xl border ${border} bg-white/[0.02] hover:bg-white/[0.04] transition-all group`}
                >
                  <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{label}</p>
                    <p className="text-foreground/50 text-xs mt-1 leading-relaxed">
                      {description}
                    </p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-foreground/20 group-hover:text-foreground/50 transition-colors mt-0.5 flex-shrink-0" />
                </Link>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Contribution Workflow */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold mb-2">Contribution Workflow</h2>
          <p className="text-foreground/50 text-sm mb-10">
            The full guide lives in{" "}
            <Link
              href="https://github.com/Pulsefy/LumenPulse/blob/main/CONTRIBUTING.md"
              target="_blank"
              className="text-primary hover:underline"
            >
              CONTRIBUTING.md
            </Link>
            . Here's the short version.
          </p>
          <div className="relative">
            {/* vertical line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-white/5 hidden sm:block" />
            <div className="flex flex-col gap-6">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <div key={title} className="flex gap-5 items-start">
                  <div className="relative flex-shrink-0 w-10 h-10 rounded-full border border-white/10 bg-background flex items-center justify-center z-10">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary/20 border border-primary/40 text-[9px] font-bold flex items-center justify-center text-primary">
                      {i + 1}
                    </span>
                  </div>
                  <div className="pt-1.5">
                    <p className="font-medium text-sm">{title}</p>
                    <p className="text-foreground/50 text-xs mt-1 leading-relaxed max-w-lg">
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Commit convention quick ref */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold mb-2">Commit Convention</h2>
          <p className="text-foreground/50 text-sm mb-6">
            All commits must follow{" "}
            <Link
              href="https://www.conventionalcommits.org"
              target="_blank"
              className="text-primary hover:underline"
            >
              Conventional Commits
            </Link>
            .
          </p>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 font-mono text-sm space-y-2">
            <p className="text-foreground/40 text-xs mb-3"># format</p>
            <p className="text-foreground/80">
              <span className="text-primary">&lt;type&gt;</span>
              <span className="text-foreground/40">(&lt;scope&gt;)</span>
              <span className="text-foreground/60">
                : &lt;short summary&gt;
              </span>
            </p>
            <div className="border-t border-white/5 pt-3 mt-3 space-y-1.5 text-xs text-foreground/50">
              <p>
                <span className="text-pink-400">feat</span>(webapp): add
                portfolio refresh on pull
              </p>
              <p>
                <span className="text-red-400">fix</span>(backend): handle empty
                news provider response
              </p>
              <p>
                <span className="text-blue-400">docs</span>(meta): update
                contributing guidelines
              </p>
              <p>
                <span className="text-purple-400">refactor</span>(onchain):
                simplify reward distribution logic
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 border-t border-white/5">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold font-heading mb-3">
            Ready to contribute?
          </h2>
          <p className="text-foreground/50 text-sm mb-8">
            Fork the repo, pick an issue, and open your first PR. The
            maintainers are here to help.
          </p>
          <Link
            href="https://github.com/Pulsefy/LumenPulse/fork"
            target="_blank"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors font-medium"
          >
            <GitFork className="w-4 h-4" />
            Fork the Repository
          </Link>
        </div>
      </section>
    </div>
  );
}
