import { redirect } from "next/navigation";

/** Moved to /import/products (all imports are together under Import from Excel). */
export default function OldImportPage() {
  redirect("/import/products");
}
