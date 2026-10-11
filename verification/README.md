# App upgrade verification

The new Home / My Files / Tools interface uses the generated icon in
`branding/fileviewer-icon.png` and shared light/dark colors in `theme.js`.
`app.config.js` keeps the existing package identity and permissions from `app.json`
while applying the name, automatic appearance and launcher icon.

My Files keeps up to 100 recent documents / 200 MB in private app storage. Search,
type filters, starred files, rename and batch saving work from that collection;
exports have their own tab. PDF reading positions and page bookmarks follow the
content identity even when a file is selected again with a different picker URI.

The app now also includes automatic recovery for text edits and applied PDF/image
changes. Drafts use separate private document storage, a 500 ms debounce, and
background/unmount flushing. Verified metadata backups preserve the last complete
snapshot if replacement fails. The same backup flow protects the library index
and phone save preferences because Android's overwrite move deletes its target
before renaming. Home can resume/discard drafts. Reverting to the original or
exporting clears recovery. Combined draft capacity is 200 MB.

The local Expo module `modules/file-tools` implements Android text recognition
for printed Hindi or English, selected PDF pages to JPG/PNG, and paginated Hindi
text-to-PDF using native font fallback and text shaping. It uses bundled ML Kit
Latin/Devanagari 16.0.1 models and Android PdfRenderer/PdfDocument.

Limits: 20 OCR pages / 1 MiB recognized UTF-8 text per batch; 30 page images per
batch; rendered page/input maximum edge 2400 pixels; text PDF maximum 250 pages /
25 MiB. Completed batch results survive a later failure or cancellation, and
retries reuse ready exports. Recognized text can be edited, selected/copied and
saved. Existing PDF annotation text retains its supported character set: native
Hindi support applies to creating PDFs from text notes.

Validation on 2026-10-08:

- **169 local tests passed**: draft restart/partial writes, capacity, autosave
  races, background/unmount, editor recovery, original preservation, OCR retries,
  partial batches, file/library operations, saving and PDF rendering budgets.
  Storage tests also simulate failure after the Android destination is deleted,
  repeated recovery attempts and a completed move with failed source cleanup.
- **8 Edge browser tests passed**, including pinch re-rendering, 300% zoom and
  panning, delayed rendering, 1000+ pages, search, annotation targets and bounded
  text-to-image output. Approved execution resolved the initial sandbox EPERM.
- Expo Babel transforms pass for 33 JavaScript modules.
- Expo Android autolinking resolves `expo.modules.filetools.FileToolsModule`.
- Android Metro/Hermes export passes (998 modules and three assets). This is checked
  separately from native compilation: a bytecode bundle does not verify Kotlin
  compilation, OCR model loading or native font output.
- Android prebuild and generated release-configuration checks pass. The previous
  native directory is preserved in `verification/native-backup-before-upgrades`.
- Effective Expo config resolves the new square icon and preserves the Android
  package name and blocked permissions.

Commands (PowerShell, in the fileviewer directory):

```powershell
node --experimental-test-isolation=none --test --test-reporter=spec tests/*.test.cjs
node --experimental-test-isolation=none --test --test-reporter=spec tests/pdfViewer.browser.cjs tests/textImage.browser.cjs
$env:LOG_EVENTS = Join-Path (Get-Location) 'verification/android-export.log'
node node_modules/expo/bin/cli export --platform android --output-dir verification/android-bundle --max-workers 1
```

The pre-existing `.expo/dev/logs` folder rejects writes in this restricted session;
the CLI's supported `LOG_EVENTS` setting directs logs to a writable project folder.
A new native Android build is needed for OCR, Hindi PDF generation, PDF page
images and the launcher icon. These native tools are unavailable in Expo Go,
older APKs and iOS. Latin text export retains the JavaScript fallback.
This release uses app version 1.1.0 / Android version code 2.

Native compilation and phone checks remain separate validation steps. Phone
checks: Hindi matras/conjuncts and long-note pagination, Hindi/English recognition
on clear/poor scans, cancellation, image orientation, restart after Draft saved,
save-folder access across restart, narrow screens and large fonts, bookmarked
pages, renamed files and sharing. The JavaScript filesystem/UI tests simulate
recovery; they do not prove device durability during an abrupt power loss.

Implementation references:

- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/modules/get-started/
- https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- https://developers.google.com/ml-kit/terms
- https://developer.android.com/reference/android/graphics/pdf/PdfDocument
- https://developer.android.com/reference/android/text/StaticLayout.Builder
