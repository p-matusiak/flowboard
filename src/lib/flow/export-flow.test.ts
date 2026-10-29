import assert from "node:assert/strict";
import test from "node:test";
import { buildFlowJson, buildFlowText } from "./export-flow.ts";
import {
  projectZipName,
  screenNameFromFile,
  slugify,
  uniqueExportFileNames,
} from "./names.ts";

test("screen names keep the rest of the filename", () => {
  assert.equal(screenNameFromFile("lista-wydarzen.png"), "Lista wydarzen");
  assert.equal(screenNameFromFile("szczegoly.png"), "Szczegoly");
  assert.equal(slugify("Szczegóły wydarzenia"), "szczegoly-wydarzenia");
});

test("export filenames never collide", () => {
  const names = uniqueExportFileNames([
    { id: "a", name: "Szczegóły wydarzenia", mimeType: "image/png" },
    { id: "b", name: "Szczegóły wydarzenia", mimeType: "image/png" },
  ]);
  assert.equal(names.get("a"), "szczegoly-wydarzenia.png");
  assert.equal(names.get("b"), "szczegoly-wydarzenia-2.png");
});

test("zip name", () => {
  assert.equal(projectZipName("Event App"), "Event-App.zip");
});

test("flow text and json use connection ids, not positions", () => {
  const doc = {
    version: 1 as const,
    project: { id: "project_uuid", name: "Event App" },
    screens: [
      {
        id: "screen_01",
        name: "Lista wydarzeń",
        file: "screens/lista.png",
        originalFileName: "lista.png",
      },
      {
        id: "screen_02",
        name: "Szczegóły",
        file: "screens/szczegoly.png",
        originalFileName: "szczegoly.png",
      },
    ],
    connections: [
      {
        id: "connection_01",
        fromScreenId: "screen_01",
        toScreenId: "screen_02",
        fromFile: "screens/lista.png",
        toFile: "screens/szczegoly.png",
        label: "Kliknięcie wydarzenia",
      },
    ],
  };
  const text = buildFlowText(doc);
  assert.match(text, /PROJECT: Event App/);
  assert.match(text, /screens\/lista\.png/);
  assert.match(text, /screens\/szczegoly\.png/);
  assert.match(text, /ACTION:\nKliknięcie wydarzenia/);
  assert.match(text, /FROM:\nscreen_01\nscreens\/lista\.png/);
  const json = JSON.parse(buildFlowJson(doc)) as typeof doc;
  assert.equal(json.connections[0]?.fromScreenId, "screen_01");
  assert.equal(json.connections[0]?.toScreenId, "screen_02");
  assert.equal("notes" in json, false);
});

test("notes are appended without changing screen relations", () => {
  const doc = {
    version: 1 as const,
    project: { id: "p", name: "Event App" },
    screens: [
      { id: "screen_01", name: "Lista", file: "screens/lista.png", originalFileName: "lista.png" },
    ],
    notes: [{ id: "note_01", kind: "sticky" as const, text: "Ustalić datę" }],
    connections: [
      {
        id: "connection_01",
        fromScreenId: "screen_01",
        toScreenId: "note_01",
        fromFile: "screens/lista.png",
        toFile: "notes/note_01",
        label: "Dalej",
      },
    ],
  };
  const text = buildFlowText(doc);
  assert.match(text, /NOTES/);
  assert.match(text, /Kind: sticky/);
  assert.match(text, /Text: Ustalić datę/);
  assert.match(text, /FROM:\nscreen_01\nscreens\/lista\.png/);
  assert.match(text, /TO:\nnote_01\nnotes\/note_01/);
  const json = JSON.parse(buildFlowJson(doc)) as typeof doc;
  assert.equal(json.notes?.[0]?.text, "Ustalić datę");
  assert.equal(json.connections[0]?.toScreenId, "note_01");
});
