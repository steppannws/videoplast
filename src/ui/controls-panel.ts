// Builds the entire #ui control panel from the declarative PANEL config and mounts
// it into the host element. Replaces the ~80 lines of hand-written markup that used
// to live in index.html (now a single <div id="ui">).
import { renderPanel } from "./control-factory.ts";
import { PANEL } from "../config/controls.ts";

export function mountControls(host: HTMLElement): void {
  host.replaceChildren(...renderPanel(PANEL));
}
