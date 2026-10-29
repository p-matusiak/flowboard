import { create } from "zustand";

export type BoardApi = {
  commitRename: (id: string, name: string) => void;
  beginRename: (id: string) => void;
  beginLabel: (id: string) => void;
  changeLabel: (id: string, label: string) => void;
  commitLabel: (id: string, label: string) => void;
  beginBody: (id: string) => void;
  changeBody: (id: string, body: string) => void;
  commitBody: (id: string, body: string) => void;
  setFill: (id: string, fill: string) => void;
  requestReplace: (id: string) => void;
  downloadScreen: (id: string) => void;
  deleteScreen: (id: string) => void;
  retryUpload: (id: string) => void;
};

type BoardState = {
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  api: BoardApi;
};

const noop = () => {};

export const useBoardStore = create<BoardState>((set) => ({
  renamingId: null,
  setRenamingId: (id) => set({ renamingId: id }),
  api: {
    commitRename: noop,
    beginRename: (id) => set({ renamingId: id }),
    beginLabel: noop,
    changeLabel: noop,
    commitLabel: noop,
    beginBody: noop,
    changeBody: noop,
    commitBody: noop,
    setFill: noop,
    requestReplace: noop,
    downloadScreen: noop,
    deleteScreen: noop,
    retryUpload: noop,
  },
}));
