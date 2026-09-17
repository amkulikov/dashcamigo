# DDPAI GPS sidecars and Z60 Pro storage

DDPAI `.gpx` files can contain plain NMEA sentences instead of XML GPX.
For parsing and video association, see `ddpaiGpxSidecar` in
`src/parsers/sidecars/nmea-sidecar.ts`.

## Z60 Pro: inspect the internal storage

Firmware `DR2008_OVERSEAS-9.0.1.72-260618-BBS` stores GPS logs on the internal
storage even when recordings are on the removable SD card. Its paths are:

| Data | Camera filesystem path |
| --- | --- |
| NMEA `.gpx` files | `/app/sd/DCIM/203gps` |
| `.git` telemetry archives | `/app/sd/DCIM/203gps/tar` |
| Removable-card videos | `/mnt/sd/DCIM/200video/front` |

The firmware parameter file associates `/app/sd/` with `/dev/mmcblk0p9`.
The GPS collector explicitly uses storage index 0, whose directory table
contains the `/app/sd/` paths. GPS entries in the external storage table are
disabled. An SD-card copy can therefore contain full original videos while
omitting their coordinate logs.

To acquire the logs, connect the **camera itself** to a computer with a USB
data cable and inspect `DCIM/203gps` in its internal storage. Copy that directory
with its subdirectories and preserve filenames. Keep the matching original
MP4s from the SD card. The [Z60 Pro manual](https://www.ddpai.com/manuals/z60pro/)
describes USB access to eMMC under “View/Export eMMC Data”.

These findings apply to the identified firmware. A real Z60 Pro GPS sidecar is
still required to validate decoding and video association; this is not an
end-to-end support claim for every Z60 Pro hardware or firmware variant.

## Reproducible firmware evidence

The [manufacturer's recovery reply](https://dashcamtalk.com/forum/threads/z60-pro-stuck-on-start-up-screen.61423/)
links the [public firmware archive](https://drive.google.com/file/d/1pwtyUxdFlhpA1xXTlGHg4ELT3_isRbaU/view).
Static analysis requires no firmware installation. Concatenate `appfs0`,
`appfs1`, and `appfs2` in that order to read the ext4 application image.

- ZIP SHA-256: `49d9132cb3731fb3a0caef1160abc1db50f5ab39f0b3fb7f08101eaf884107b1`.
- `bin/main_app` SHA-256: `f903a98538fb9463b3e22ee336fd7d4ede8d7ab4c0524b4fca40ede8f370e58a`.
- AArch64 virtual addresses: storage directory tables at `0x1096afc` and
  `0x109aed8`, 172-byte entries; GPS file type 84 and archive type 85.
- `DDP_FILE_ImportConfig` at `0x430b98` registers both storage tables and enables
  the first two entries of the GPS collection configuration at `0x109f614`.
- `MMCCollectSaveFile` at `0xc1e098` and `MMCCollectSaveFileByCloseVideo` at
  `0xc1d414` resolve their output paths using storage index 0.
- `GPS_StartUart` at `0x47e2a8` registers the NMEA receiver with
  `MMC_CollectRecvData`; the file-header callback at `0x47ddbc` writes
  `$GPSCAMTIME` followed by the recording time.
- `API_GpsFileListReq` dispatches to `0x44b928`. Its response contains a `file`
  array with `name`, `starttime`, `endtime`, and `parentfile` fields. This is an
  alternative acquisition route through the camera's Wi-Fi API.

The manual's statement that GPS information is recorded in video does not
specify an MP4 byte format. A speed watermark alone also does not establish
that the file embeds machine-readable coordinates.
