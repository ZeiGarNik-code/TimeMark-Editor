# NonstopMaker Lite

A fast, browser-local DJ set builder inspired by the supplied NonstopMaker screenshots. It includes real local-file playback, BPM/key estimation, and MP3 mixing/rendering. No demo music is bundled, and audio is never uploaded.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL. Choose **Mở demo** to preview the interface with synthetic metadata, or select a local folder/files to work with real audio. Demo tracks do not contain audio and cannot be analyzed or rendered.

## Workflow

1. **Choose music** — select local audio files/folders and set a target duration, mood, and styles.
2. **Arrange** — search/select tracks, reorder them, run BPM/key analysis, and sort the set using estimated tempo, Camelot key, and energy.
3. **Preview & edit** — listen to an individual local track, inspect the timeline, and configure crossfade, fade length, and RMS normalization. Imported-file waveform peaks are sampled locally during analysis or rendering; demo tracks use decorative waveforms.
4. **Export** — render selected local audio to an MP3, or download an M3U8 playlist / JSON mix plan.

## Local audio analysis

- Audio is decoded with the browser's Web Audio API and analyzed in a dedicated Web Worker; files are not sent to a server.
- BPM, musical-key/Camelot, and RMS-based energy results are estimates, not professional beat-grid or key-detection guarantees. BPM/RMS energy use up to the first 120 seconds; key detection uses up to 75 seconds. The browser may need to decode the source file before analysis starts.
- Analysis is limited to 200 MB per source file. Supported input formats depend on the browser's audio decoder; common MP3, WAV, FLAC, M4A, and AAC files are the best-supported choices.

## MP3 rendering

- The browser decodes each selected track, applies per-track RMS gain normalization (optional), mixes equal-power crossfades, and encodes MP3 in a dedicated worker using `@breezystack/lamejs`.
- Choose 128, 192, or 256 kbps. Fade length can be rounded to a beat count using the measured BPM when analysis data is available. This is not time-stretching, phase alignment, or full DJ-style beatmatching.
- Browser render limits: 120 MB per source track, 15 minutes per track, 120 minutes per set. Input decoding and supported MP3 sample rates vary by browser/device. Long mixes may use substantial memory; render shorter sets on low-memory devices.
- Once rendering completes, click **Tải MP3** to download the generated file. The original files remain untouched and local.

## Performance / privacy

- No sample library, demo audio, or original large audio files are included in the repository.
- Heavy analysis and MP3-render code is dynamically loaded only when those actions are used; MP3 encoding runs in a worker.
- The TimeMark Studio OCR/OpenCV modules remain separate from the default NonstopMaker route.

## Windows desktop app (.exe)

A Windows 64-bit Electron wrapper is included. It loads the bundled UI through a secure local protocol, keeps Node integration disabled, and does not need a server or network connection for audio work.

- On a Windows development machine, run `npm ci` then `npm run package:win`. The `release/` directory receives both an NSIS installer and a portable `.exe`.
- The **Build NonstopMaker for Windows** GitHub Actions workflow also packages both executables. Download the `NonstopMaker-Lite-Windows` artifact from the workflow run.
- To sign the Windows executables, add an organization/publisher code-signing certificate as the repository Actions secret `WINDOWS_CSC_PFX_BASE64` (base64-encoded PFX) and its password as `WINDOWS_CSC_KEY_PASSWORD`. If either secret is absent, the workflow labels the artifact unsigned; unsigned builds may show a Windows SmartScreen warning. Never put the certificate or password in source control. No original audio files or music samples are included in the build.

## Test and build

```bash
npm test
npm run build
npm run build:desktop
npm run preview
```

## Legacy TimeMark Studio

The original TimeMark Studio app remains available at `?app=timemark`. To copy its local OCR/OpenCV assets for a legacy build, run `npm run prepare:timemark-assets` first. Those large assets are not copied into the default NonstopMaker Lite build.
