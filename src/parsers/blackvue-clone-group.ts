// BlackVue channel pairing is used by external log cloning, not the embedded
// video parser registry. Keeping it separate prevents unrelated filename-mode
// patterns from entering embedded cache revisions through module side effects.

import { blackvueChannelGroupKey } from "./filename/_patterns.js";
import { strippedParentPath } from "./primitives/clone-groups.js";
import type { VendorFile } from "./types.js";

const GROUP_SEPARATOR = String.fromCharCode(0);

/** Source-local BlackVue recording key, with manual channel folders folded. */
export function blackvueChannelCloneGroup(file: VendorFile): string | null {
    const recording = blackvueChannelGroupKey(file.file.name);
    if (recording === null) return null;
    return [strippedParentPath(file, ["front", "rear", "interior"]), recording].join(GROUP_SEPARATOR);
}
