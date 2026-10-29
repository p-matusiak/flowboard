import { createFileRoute, Link } from "@tanstack/react-router";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { FlowBoard } from "@/components/board/flow-board";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/p/$projectId")({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper">
        <p className="text-sm text-muted">Wczytywanie…</p>
      </main>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return (
    <>
      <div className="editor-mobile-note fixed inset-0 items-center justify-center bg-paper p-6">
        <div className="surface max-w-sm p-4 text-center">
          <Logo />
          <h1 className="mt-4 text-lg font-semibold">Edytor działa na komputerze</h1>
          <p className="mt-2 text-sm text-muted">
            Tablica screenshotów potrzebuje szerokości co najmniej 1024 px. Otwórz projekt na laptopie albo poszerz okno.
          </p>
          <Link to="/" className="btn btn-primary mt-4">
            Wróć do projektów
          </Link>
        </div>
      </div>
      <div className="editor-desktop fixed inset-0">
        <FlowBoard projectId={projectId} />
      </div>
    </>
  );
}
