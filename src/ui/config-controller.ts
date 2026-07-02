// Export / import / hand-edit the whole settings JSON blob. Export downloads a
// pretty-printed file; import reads a chosen file; "EDIT JSON" opens a modal with
// the current settings in a textarea. Applying an import or edit replaces the
// persisted blob and reloads so every bindControl re-reads its value.
import { exportSettings, parseSettings, replaceSettings } from "./persist.ts";

export class ConfigController {
  constructor(private readonly setStatus: (s: string) => void) {}

  wire(): void {
    const exportBtn = document.getElementById("cfgExport");
    if (exportBtn) exportBtn.onclick = () => this.download();

    const importInput = document.getElementById("cfgImport") as HTMLInputElement | null;
    if (importInput) importInput.addEventListener("change", (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) this.importFile(f);
      importInput.value = "";
    });

    const editBtn = document.getElementById("cfgEdit");
    if (editBtn) editBtn.onclick = () => this.openEditor();
  }

  private download(): void {
    const blob = new Blob([exportSettings()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `videoplaster-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus("settings exported");
  }

  private importFile(f: File): void {
    const reader = new FileReader();
    reader.onload = () => this.apply(String(reader.result ?? ""));
    reader.onerror = () => this.setStatus("import failed: could not read file");
    reader.readAsText(f);
  }

  // Validate, persist, and reload. Returns false (and reports) on bad JSON so the
  // editor can stay open for correction.
  private apply(json: string): boolean {
    let obj: Record<string, unknown>;
    try {
      obj = parseSettings(json);
    } catch (err) {
      this.setStatus("invalid JSON: " + (err as Error).message);
      return false;
    }
    replaceSettings(obj);
    location.reload();
    return true;
  }

  private openEditor(): void {
    if (document.getElementById("cfgModal")) return;

    const ta = document.createElement("textarea");
    ta.id = "cfgEditText";
    ta.spellcheck = false;
    ta.value = exportSettings();

    const err = document.createElement("div");
    err.className = "cfg-modal__err";

    const apply = document.createElement("button");
    apply.textContent = "APPLY & RELOAD";
    apply.onclick = () => { if (!this.apply(ta.value)) err.textContent = "invalid JSON — not saved"; };

    const cancel = document.createElement("button");
    cancel.textContent = "CANCEL";
    cancel.onclick = () => close();

    const actions = document.createElement("div");
    actions.className = "cfg-modal__actions";
    actions.append(apply, cancel);

    const box = document.createElement("div");
    box.className = "cfg-modal__box";
    box.append(ta, err, actions);

    const modal = document.createElement("div");
    modal.id = "cfgModal";
    modal.className = "cfg-modal";
    modal.append(box);

    const close = (): void => { modal.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", onKey);

    document.body.append(modal);
    ta.focus();
  }
}
