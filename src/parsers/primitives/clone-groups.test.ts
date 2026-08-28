import { describe, expect, it } from "vitest";

import type { VendorFile } from "../types.js";
import { blackvueChannelCloneGroup } from "../blackvue-clone-group.js";
import { juscarTsCloneGroup, videoCloneAffinityKey } from "./clone-groups.js";

function file(path: string): VendorFile {
    return { file: new File([], path.split("/").pop()!), relativePath: path, sourceKey: "drop" };
}

describe("clone group source isolation", () => {
    it("pairs Juscar channel folders under one rig but not equal timestamps under another rig", () => {
        const front = file("rig-a/video/front/20260512_150820F.ts");
        const rear = file("rig-a/video/rear/20260512_150820R.ts");
        const other = file("rig-b/video/front/20260512_150820F.ts");

        const group = juscarTsCloneGroup(front)!;
        expect(group).toBe(juscarTsCloneGroup(rear));
        expect(group).toBe(juscarTsCloneGroup(other));
        expect(videoCloneAffinityKey("juscar-ts", front, group)).toBe(videoCloneAffinityKey("juscar-ts", rear, group));
        expect(videoCloneAffinityKey("juscar-ts", front, group)).not.toBe(
            videoCloneAffinityKey("juscar-ts", other, group),
        );
    });

    it("pairs BlackVue channel folders under one rig but isolates another rig", () => {
        const front = file("rig-a/front/20260718_070333_NF.mp4");
        const rear = file("rig-a/rear/20260718_070333_NR.mp4");
        const other = file("rig-b/front/20260718_070333_NF.mp4");

        expect(blackvueChannelCloneGroup(front)).toBe(blackvueChannelCloneGroup(rear));
        expect(blackvueChannelCloneGroup(front)).not.toBe(blackvueChannelCloneGroup(other));
    });
});
