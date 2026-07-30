import {
  Outlet,
  Link,
  createRootRoute,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "google-site-verification", content: "_Gyq5mirHsRjbJcyQty8rQ1xqVY6Uaa6aSCl6rUq2QI" },
      // No backend to enforce anything here, so the token (stored in
      // localStorage) is only as safe as the browser tab it lives in —
      // this is the structural backstop: even if a future change ever
      // renders untrusted content unsafely, connect-src limits where a
      // compromised page could send data. (frame-ancestors and other
      // header-only directives can't be set via meta — see public/_headers
      // for those, when the hosting platform honors it.)
      //
      // script-src needs 'unsafe-inline': TanStack Start SSR-hydrates via
      // its own inline <script> bootstrap tag (window.$_TSR) with a
      // different hash on every request — verified live that omitting
      // 'unsafe-inline' blocks that script outright and breaks hydration
      // completely, not just a theoretical hardening gap. A per-request
      // nonce would remove the need for it, but requires the server to
      // generate and thread a nonce through to that framework-internal
      // script tag, which isn't something this app controls today.
      // connect-src — the directive that actually matters for this app's
      // token — stays fully locked down regardless.
      {
        httpEquiv: "Content-Security-Policy",
        content:
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: https://avatars.githubusercontent.com; " +
          "connect-src 'self' https://api.github.com; " +
          "base-uri 'self'; " +
          "form-action 'self'",
      },
      { title: "Repository File Count — Analyze any GitHub repo" },
      {
        name: "description",
        content:
          "Analyze any public GitHub repository's file breakdown by extension, health signals, and pull request velocity — directly in your browser, no install or backend required.",
      },
      { property: "og:title", content: "Repository File Count" },
      {
        property: "og:description",
        content:
          "File breakdown by extension, repository health, and pull request velocity for any public GitHub repo — browser-only, nothing installed.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://repo-file-count.vercel.app/" },
      { property: "og:image", content: "https://repo-file-count.vercel.app/og-hero.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "Repository File Count — github → tree → count",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Repository File Count" },
      {
        name: "twitter:description",
        content: "A polished, browser-only file-count analyzer for GitHub repositories.",
      },
      { name: "twitter:image", content: "https://repo-file-count.vercel.app/og-hero.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon-64x64.png", type: "image/png", sizes: "64x64" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}

function RootComponent() {
  // Required: nested routes render here. Removing <Outlet /> breaks all child routes.
  return <Outlet />;
}
