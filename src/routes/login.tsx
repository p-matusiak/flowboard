import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authClient, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { Logo } from "@/components/logo";
import { rememberSessionToken } from "@/lib/session-token";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.includes("@") || password.length < 8) {
      toast.error("Podaj e-mail i hasło o długości co najmniej 8 znaków");
      return;
    }
    setBusy(true);
    try {
      const result =
        mode === "up"
          ? await authClient.signUp.email({
              email: email.trim(),
              password,
              name: email.trim().split("@")[0] || "Użytkownik",
            })
          : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        const raw = result.error.message ?? "";
        toast.error(
          raw.toLowerCase().includes("exist")
            ? "Konto z tym adresem już istnieje"
            : mode === "in"
              ? "Nieprawidłowy e-mail lub hasło"
              : "Nie udało się utworzyć konta",
        );
        setBusy(false);
        return;
      }
      rememberSessionToken(result.data?.token ?? null);
      await authClient.getSession();
      window.location.assign("/");
    } catch {
      toast.error("Nie udało się zalogować");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="surface w-full max-w-md p-4">
        <Logo />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {mode === "in" ? "Zaloguj się" : "Utwórz konto"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Tablica screenshotów i strzałek między ekranami. Każdy projekt jest widoczny tylko dla Ciebie.
        </p>
        <form className="mt-6 space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Hasło</span>
            <input
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <button className="btn btn-primary w-full" type="submit" disabled={busy}>
            {busy ? "Chwila…" : mode === "in" ? "Zaloguj się" : "Utwórz konto"}
          </button>
        </form>
        <button
          type="button"
          className="btn btn-ghost mt-2 w-full"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "Nie masz konta? Utwórz" : "Masz już konto? Zaloguj się"}
        </button>
        <div className="my-4 h-px bg-line" />
        <div className="grid gap-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              className="btn btn-secondary w-full"
              onClick={() => {
                void signIn(provider.providerId, { callbackURL: "/" }).catch(() => {
                  toast.error("Nie udało się rozpocząć logowania");
                });
              }}
            >
              Kontynuuj z {provider.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-subtle">
          <Link to="/" className="underline-offset-2 hover:underline">
            Wróć
          </Link>
        </p>
      </div>
    </main>
  );
}
