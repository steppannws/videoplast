// Typed view of the persisted settings object (one localStorage blob).
// Stable keys are listed for call-site typing; control values (keyed by element
// id) and dynamic effect params (fx.<effectId>.<key>) share the index signature.
import type { Roi } from "./domain.ts";

export interface Settings {
  roi?: Roi;
  camDevice?: string;
  "fx.active"?: string;
  uiHidden?: boolean;
  pinSchema?: string;
  [key: string]: unknown;
}
