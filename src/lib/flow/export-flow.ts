export type FlowScreen = {
  id: string;
  name: string;
  file: string;
  originalFileName: string;
};

export type FlowNote = {
  id: string;
  kind: "sticky" | "frame";
  text: string;
};

export type FlowConnection = {
  id: string;
  fromScreenId: string;
  toScreenId: string;
  fromFile: string;
  toFile: string;
  label: string | null;
};

export type FlowDocument = {
  version: 1;
  project: { id: string; name: string };
  screens: FlowScreen[];
  notes?: FlowNote[];
  connections: FlowConnection[];
};

/**
 * Human-readable flow. Relations come only from connection ids,
 * never from canvas coordinates.
 * Screen-only documents stay in the original shape.
 */
export function buildFlowText(doc: FlowDocument): string {
  const screens = doc.screens
    .map(
      (screen) =>
        `[${screen.id}]\nName: ${screen.name}\nFile: ${screen.file}\nOriginal file: ${screen.originalFileName}`,
    )
    .join("\n\n");

  const connections =
    doc.connections.length === 0
      ? "(brak)"
      : doc.connections
          .map((connection) => {
            const action = connection.label?.trim() ? connection.label.trim() : "";
            return `[${connection.id}]\n\nFROM:\n${connection.fromScreenId}\n${connection.fromFile}\n\nTO:\n${connection.toScreenId}\n${connection.toFile}\n\nACTION:\n${action}`;
          })
          .join("\n\n");

  const notes =
    doc.notes && doc.notes.length
      ? `\n\nNOTES\n\n${doc.notes
          .map((note) => `[${note.id}]\nKind: ${note.kind}\nText: ${note.text}`)
          .join("\n\n")}`
      : "";

  return `PROJECT: ${doc.project.name}\n\nSCREENS\n\n${screens || "(brak)"}\n\nCONNECTIONS\n\n${connections}${notes}\n`;
}

export function buildFlowJson(doc: FlowDocument): string {
  const payload: FlowDocument = {
    version: 1,
    project: doc.project,
    screens: doc.screens,
    connections: doc.connections,
  };
  if (doc.notes && doc.notes.length) payload.notes = doc.notes;
  return `${JSON.stringify(payload, null, 2)}\n`;
}
