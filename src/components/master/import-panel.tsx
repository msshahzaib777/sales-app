"use client";

import { startTransition, useActionState, useRef } from "react";

import { FormMessage } from "@/components/form/form-message";
import { DataTable, Td, Th } from "@/components/list/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { idleState } from "@/lib/action-state";
import { importCommitAction, importPreviewAction } from "@/server/master-actions";
import type { ImportPreview } from "@/server/services/master/import";
import type { ImportKind } from "@/server/services/master/import-rows";

const PREVIEW_LIMIT = 300;

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function download(fileName: string, rows: string[][]) {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Two steps: "Check file" shows every row with its status and errors (nothing is saved), then
 * "Import" sends the same file again; the server re-validates it and saves the valid rows.
 */
export function ImportPanel({
  kind,
  templateHeaders,
  notes,
}: {
  kind: ImportKind;
  templateHeaders: string[];
  notes: string[];
}) {
  const [preview, previewAction, previewing] = useActionState(
    importPreviewAction.bind(null, kind),
    idleState,
  );
  const [result, commitAction, importing] = useActionState(
    importCommitAction.bind(null, kind),
    idleState,
  );
  // React clears the file input after "Check file", so keep the checked file (and an id for this
  // import attempt) to send exactly that file when the user confirms.
  const checked = useRef<{ file: File; requestId: string } | null>(null);

  const data: ImportPreview | undefined = preview.status === "success" ? preview.data : undefined;
  const importable = data ? data.newCount + data.updateCount : 0;
  const done = result.status === "success";

  const commit = () => {
    if (!checked.current) return;
    const formData = new FormData();
    formData.set("file", checked.current.file);
    formData.set("requestId", checked.current.requestId);
    startTransition(() => commitAction(formData));
  };

  const errorReport = () => {
    if (!data) return;
    const columns = Object.keys(data.rows[0]?.values ?? {});
    download(`${kind}-import-errors.csv`, [
      ["Row", "Errors", ...columns],
      ...data.rows
        .filter((r) => r.status === "error")
        .map((r) => [
          String(r.line),
          r.errors.join("; "),
          ...columns.map((c) => r.values[c] ?? ""),
        ]),
    ]);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <section aria-labelledby="format-heading" className="space-y-2 rounded-lg border p-4 text-sm">
        <h2 id="format-heading" className="font-medium">
          File format
        </h2>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => download(`${kind}-template.csv`, [templateHeaders])}
        >
          Download template (CSV)
        </Button>
      </section>

      <form
        action={(formData) => {
          const file = formData.get("file");
          checked.current = file instanceof File ? { file, requestId: crypto.randomUUID() } : null;
          previewAction(formData);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="space-y-1.5">
          <Label htmlFor="import-file">Excel (.xlsx) or CSV file, up to 2 MB</Label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            required
            className="file:bg-background block text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={previewing}>
          {previewing ? "Checking…" : "Check file"}
        </Button>
      </form>
      <FormMessage state={preview.status === "error" ? preview : idleState} />

      {data ? (
        <section aria-labelledby="preview-heading" className="space-y-3">
          <h2 id="preview-heading" className="font-medium">
            Preview of {data.fileName}
          </h2>
          <p className="text-sm">
            {data.totalRows} rows: <strong>{data.newCount} new</strong>
            {kind === "products" ? (
              <>
                , <strong>{data.updateCount} update existing codes</strong>
              </>
            ) : null}
            , <strong>{data.errorCount} with errors</strong> (skipped). Nothing has been saved yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={commit} disabled={importing || importable === 0 || done}>
              {importing
                ? "Importing…"
                : `Import ${importable} ${importable === 1 ? "row" : "rows"}`}
            </Button>
            {data.errorCount > 0 ? (
              <Button type="button" variant="outline" onClick={errorReport}>
                Download error report
              </Button>
            ) : null}
          </div>
          <FormMessage state={result} />

          <DataTable className="max-h-[32rem] overflow-y-auto">
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Result</Th>
                {Object.keys(data.rows[0]?.values ?? {}).map((c) => (
                  <Th key={c}>{c}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                <tr key={row.line}>
                  <Td className="tabular-nums">{row.line}</Td>
                  <Td className="min-w-48">
                    {row.status === "error" ? (
                      <>
                        <Badge variant="destructive">Error</Badge>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {row.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <Badge variant={row.status === "new" ? "secondary" : "outline"}>
                        {row.status === "new" ? "New" : "Update"}
                      </Badge>
                    )}
                  </Td>
                  {Object.entries(row.values).map(([c, v]) => (
                    <Td key={c} className="whitespace-nowrap">
                      {v}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </DataTable>
          {data.rows.length > PREVIEW_LIMIT ? (
            <p className="text-muted-foreground text-sm">
              Showing the first {PREVIEW_LIMIT} rows. The error report lists all rows with errors.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
