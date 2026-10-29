import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Logo } from "@/components/logo";
import { screenCountLabel } from "@/lib/flow/names";
import type { ProjectRecord } from "@/lib/flow/types";
import { createProject, deleteProject, listProjects, renameProject } from "@/lib/server/flow.functions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <main className="min-h-dvh bg-paper">
        <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-3">
          <Logo />
        </header>
        <div className="mx-auto max-w-5xl px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight">Projekty</h1>
          <p className="mt-1 text-sm text-muted">Wczytywanie…</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-hidden="true">
            <div className="surface h-28 animate-pulse" />
            <div className="surface h-28 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }
  if (!user) return <RedirectToSignIn />;
  return <Dashboard />;
}

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUserState();
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Nowy projekt");
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let ignore = false;
    listProjects()
      .then((rows) => {
        if (!ignore) setProjects(rows);
      })
      .catch(() => {
        if (!ignore) {
          setProjects([]);
          toast.error("Nie udało się wczytać projektów");
        }
      });
    return () => {
      ignore = true;
    };
  }, [user?.id]);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    try {
      const project = await createProject({ data: { name: next } });
      await navigate({ to: "/p/$projectId", params: { projectId: project.id } });
    } catch {
      toast.error("Nie udało się zapisać projektu");
    }
  }

  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <Logo />
        <div className="ml-auto">
          <UserButton />
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projekty</h1>
            <p className="mt-1 text-sm text-muted">Screenshoty, notatki i ramki tekstu, połączone strzałkami.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Nowy projekt
          </button>
        </div>
        {projects === null ? <p className="mt-8 text-sm text-muted">Wczytywanie projektów…</p> : null}
        {projects && projects.length === 0 ? (
          <div className="surface mt-8 p-4">
            <h2 className="font-semibold">Nie masz jeszcze projektów</h2>
            <p className="mt-1 text-sm text-muted">Utwórz pierwszy, a potem upuść na tablicę screenshoty PNG, JPG lub WebP.</p>
          </div>
        ) : null}
        {projects && projects.length > 0 ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id} className="surface p-4">
                <ProjectCard
                  project={project}
                  onRenamed={(next) =>
                    setProjects((current) =>
                      current?.map((item) => (item.id === project.id ? { ...item, name: next } : item)) ?? null,
                    )
                  }
                  onDelete={() => setPendingDelete(project)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {creating ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true">
          <form className="surface w-full max-w-md p-4" onSubmit={(event) => void onCreate(event)}>
            <h2 className="text-lg font-semibold">Nowy projekt</h2>
            <label className="field mt-4">
              <span>Nazwa</span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={80} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
                Anuluj
              </button>
              <button type="submit" className="btn btn-primary">
                Utwórz
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {pendingDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true">
          <div className="surface w-full max-w-md p-4">
            <h2 className="text-lg font-semibold">Usunąć projekt?</h2>
            <p className="mt-2 text-sm text-muted">
              „{pendingDelete.name}” wraz ze screenshotami i połączeniami zostanie usunięty.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>
                Anuluj
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: "var(--color-danger)" }}
                onClick={() => {
                  const id = pendingDelete.id;
                  setPendingDelete(null);
                  void deleteProject({ data: { id } })
                    .then(() => setProjects((current) => current?.filter((item) => item.id !== id) ?? []))
                    .catch(() => toast.error("Nie udało się zapisać projektu"));
                }}
              >
                Usuń
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ProjectCard({
  project,
  onRenamed,
  onDelete,
}: {
  project: ProjectRecord;
  onRenamed: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const when = format(new Date(project.updatedAt), "d MMM yyyy, HH:mm", { locale: pl });
  return (
    <div>
      {editing ? (
        <input
          className="text-input"
          defaultValue={project.name}
          autoFocus
          aria-label="Nazwa projektu"
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            setEditing(false);
            if (!next || next === project.name) return;
            onRenamed(next);
            void renameProject({ data: { id: project.id, name: next } }).catch(() => {
              onRenamed(project.name);
              toast.error("Nie udało się zapisać projektu");
            });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="project-name-btn px-0" onClick={() => setEditing(true)}>
          {project.name}
        </button>
      )}
      <p className="mt-1 text-sm text-muted">
        {screenCountLabel(project.screenCount)} · {when}
      </p>
      <div className="mt-4 flex gap-2">
        <Link to="/p/$projectId" params={{ projectId: project.id }} className="btn btn-primary">
          Otwórz
        </Link>
        <button type="button" className="btn btn-secondary btn-danger" onClick={onDelete}>
          <Trash2 size={14} />
          Usuń
        </button>
      </div>
    </div>
  );
}
