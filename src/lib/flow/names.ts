import type { AllowedMime } from "./types";

const PL_MAP: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "a",
  Ć: "c",
  Ę: "e",
  Ł: "l",
  Ń: "n",
  Ó: "o",
  Ś: "s",
  Ź: "z",
  Ż: "z",
};

/** "lista-wydarzen.png" -> "Lista wydarzen". Original filename is not modified. */
export function screenNameFromFile(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const spaced = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "Ekran";
  return spaced.charAt(0).toLocaleUpperCase("pl") + spaced.slice(1);
}

export function extForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}

export function slugify(name: string): string {
  const mapped = [...name.trim().toLowerCase()].map((ch) => PL_MAP[ch] ?? ch).join("");
  const slug = mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "ekran";
}

/** Readable, unique names inside the zip. Never collides. */
export function uniqueExportFileNames(
  screens: Array<{ id: string; name: string; mimeType: string }>,
): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const screen of screens) {
    const ext = extForMime(screen.mimeType);
    const base = slugify(screen.name);
    let name = `${base}${ext}`;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n}${ext}`;
      n += 1;
    }
    used.add(name);
    map.set(screen.id, name);
  }
  return map;
}

/** "Event App" -> "Event-App.zip" */
export function projectZipName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cleaned || "projekt"}.zip`;
}

export function safeStoredFileName(filename: string, mime: AllowedMime): string {
  const ext = extForMime(mime);
  const base = filename.replace(/^.*[/\\]/, "").trim();
  const cleaned = base.replace(/[^\w.\- ()\u00C0-\u024FąęćłńóśźżĄĘĆŁŃÓŚŹŻ]+/g, "_").slice(0, 160);
  if (!cleaned || cleaned === "." || cleaned === "..") return `obraz${ext}`;
  if (!/\.[a-z0-9]+$/i.test(cleaned)) return `${cleaned}${ext}`;
  return cleaned;
}

export function sniffImage(bytes: Uint8Array): AllowedMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function mimeFromFile(file: { type: string; name: string }): AllowedMime | null {
  const type = file.type.toLowerCase();
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp") return type;
  if (type === "image/jpg") return "image/jpeg";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

export function screenCountLabel(count: number): string {
  if (count === 1) return "1 ekran";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ekrany`;
  return `${count} ekranów`;
}

export function displaySizeFor(naturalW: number, naturalH: number): { width: number; height: number } {
  const header = 58;
  const ratio = naturalW > 0 && naturalH > 0 ? naturalW / naturalH : 9 / 19.5;
  let width = naturalW >= naturalH ? 300 : 220;
  let imageHeight = width / ratio;
  const maxImage = 460;
  if (imageHeight > maxImage) {
    imageHeight = maxImage;
    width = imageHeight * ratio;
  }
  width = Math.max(180, Math.min(340, width));
  imageHeight = width / ratio;
  return { width: Math.round(width), height: Math.round(imageHeight + header) };
}

export function gridPosition(
  index: number,
  count: number,
  origin: { x: number; y: number },
): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: origin.x + col * 360, y: origin.y + row * 480 };
}
