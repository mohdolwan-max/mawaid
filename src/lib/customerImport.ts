// Importing a clinic's existing customers (0073): reading the list as it
// comes (a CSV file, or cells pasted from Excel or Google Sheets) and
// checking each row the way the database will, so the preview says what
// will happen before anything is written. Free of React and the database
// so it can be tested directly (ENGINEERING-STANDARDS §4).

import { isValidPhone, normalizePhone } from "@/lib/phone";

export const IMPORT_MAX = 2000;

/** Splits text into rows of cells. The delimiter is guessed from the
 *  first line (tab when pasted from a spreadsheet, else ; or ,). Quoted
 *  cells may hold delimiters, quotes ("") and line breaks. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = count("\t") > 0 ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

type Field = "name" | "phone" | "email" | "notes" | "tags";
const HEADERS: Record<Field, string[]> = {
  name: ["name", "full name", "customer", "client", "الاسم", "اسم", "الاسم الكامل", "اسم الزبون", "اسم العميل", "الزبون", "العميل"],
  phone: ["phone", "mobile", "tel", "telephone", "number", "phone number", "mobile number", "الهاتف", "الجوال", "الموبايل", "رقم الهاتف", "رقم الجوال", "الرقم", "رقم", "هاتف", "جوال", "موبايل"],
  email: ["email", "e-mail", "mail", "البريد", "البريد الإلكتروني", "الايميل", "الإيميل", "ايميل", "بريد"],
  notes: ["notes", "note", "comments", "ملاحظات", "ملاحظة", "تعليق", "تعليقات"],
  tags: ["tags", "tag", "labels", "وسوم", "الوسوم", "وسم", "تصنيف"],
};
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Which column holds what. With a header row, by its names; without
 *  one, name then phone then email then notes. */
export function mapColumns(rows: string[][]): { header: boolean; columns: Partial<Record<Field, number>> } {
  const first = (rows[0] ?? []).map(norm);
  const columns: Partial<Record<Field, number>> = {};
  for (const f of Object.keys(HEADERS) as Field[]) {
    const idx = first.findIndex((h) => HEADERS[f].includes(h));
    if (idx >= 0) columns[f] = idx;
  }
  if (columns.name !== undefined || columns.phone !== undefined) return { header: true, columns };
  return { header: false, columns: { name: 0, phone: 1, email: 2, notes: 3 } };
}

export type ImportReason = "name" | "phone" | "email" | "notes" | "tags" | "duplicate";

export type ImportRow = {
  /** 1-based line in the list as given (header counted). */
  line: number;
  name: string;
  phone: string;
  email: string;
  notes: string;
  tags: string[];
  /** null = will be imported. */
  problem: ImportReason | null;
};

/** The whole preview: every row with what will happen to it. */
export function previewImport(text: string): { rows: ImportRow[]; header: boolean; tooMany: boolean } {
  const all = parseDelimited(text);
  const { header, columns } = mapColumns(all);
  const body = header ? all.slice(1) : all;
  const seen = new Set<string>();
  const rows: ImportRow[] = body.map((cells, i) => {
    const get = (f: Field) => (columns[f] !== undefined ? (cells[columns[f]!] ?? "").trim() : "");
    const name = get("name");
    const rawPhone = get("phone");
    const email = get("email").toLowerCase();
    const notes = get("notes");
    const tags = get("tags")
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const phone = normalizePhone(rawPhone);
    let problem: ImportReason | null = null;
    if (!isValidPhone(rawPhone)) problem = "phone";
    else if (name.length < 1 || name.length > 80) problem = "name";
    else if (email !== "" && (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) problem = "email";
    else if (notes.length > 2000) problem = "notes";
    else if (tags.some((t) => t.length > 30)) problem = "tags";
    else if (seen.has(phone)) problem = "duplicate";
    if (problem === null) seen.add(phone);
    return { line: i + (header ? 2 : 1), name, phone: problem === "phone" ? rawPhone : phone, email, notes, tags, problem };
  });
  return { rows, header, tooMany: rows.filter((r) => r.problem === null).length > IMPORT_MAX };
}

/** The rows to send: only those the preview accepted. */
export function rowsToSend(rows: readonly ImportRow[]): { name: string; phone: string; email: string; notes: string; tags: string[] }[] {
  return rows
    .filter((r) => r.problem === null)
    .slice(0, IMPORT_MAX)
    .map(({ name, phone, email, notes, tags }) => ({ name, phone, email, notes, tags }));
}
