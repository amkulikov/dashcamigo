import { describe, expect, it } from "vitest";
import { needsDdpaiGpsFolder } from "./ddpai-gps-help.js";
import { makeVendorFile } from "./parsers/__fixtures__/helpers.js";

describe("DDPAI GPS storage hint", () => {
    const video = { ...makeVendorFile("card/DCIM/200video/front/20261006214554_0060.mp4", ""), sourceKey: "card" };

    it("requires a DDPAI video directory as well as the filename shape", () => {
        expect(needsDdpaiGpsFolder(video, [video])).toBe(true);
        expect(needsDdpaiGpsFolder(video, [])).toBe(false);
        expect(needsDdpaiGpsFolder({ ...video, relativePath: video.file.name }, [])).toBe(false);
        expect(needsDdpaiGpsFolder({ ...video, relativePath: `100video/${video.file.name}` }, [])).toBe(false);
        expect(needsDdpaiGpsFolder({ ...video, relativePath: `other200video/${video.file.name}` }, [])).toBe(false);
        expect(needsDdpaiGpsFolder(makeVendorFile("card/DCIM/200video/front/clip.mp4", ""), [])).toBe(false);
    });

    it("stays silent when GPS files or archives are already supplied for that storage root", () => {
        for (const path of ["203gps/clip.gpx", "203gps/tar/archive.git", "203gps/tar/tmp/archive_T.git"]) {
            const gps = { ...makeVendorFile(`card/DCIM/${path}`, ""), sourceKey: "card" };
            expect(needsDdpaiGpsFolder(video, [video, gps])).toBe(false);
            expect(needsDdpaiGpsFolder(video, [video, { ...gps, sourceKey: "another-card" }])).toBe(true);
            expect(needsDdpaiGpsFolder(video, [video, { ...gps, relativePath: `another/DCIM/${path}` }])).toBe(true);
        }
    });
});
