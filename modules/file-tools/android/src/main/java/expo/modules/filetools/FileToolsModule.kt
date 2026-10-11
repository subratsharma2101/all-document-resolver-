package expo.modules.filetools

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

class FileToolsModule : Module() {
  private val workLock = Any()
  private val context get() = requireNotNull(appContext.reactContext) { "The app is not ready. Try again." }

  override fun definition() = ModuleDefinition {
    Name("FileTools")
    AsyncFunction("pdfInfo") { uri: String -> synchronized(workLock) {
      withPdf(uri) { renderer -> mapOf("pageCount" to renderer.pageCount) }
    } }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("recognize") { uri: String, kind: String, page: Int, language: String -> synchronized(workLock) {
      require(language == "latin" || language == "devanagari") { "Choose Hindi or English recognition." }
      val bitmap = if (kind == "pdf") renderPage(uri, page, 2400) else {
        require(kind == "image") { "Choose an image or a PDF." }
        decodeImage(uri)
      }
      try {
        val recognizer = if (language == "devanagari") TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
          else TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
          val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
          require(result.text.toByteArray(Charsets.UTF_8).size <= 1024 * 1024) { "Recognized text is too large. Choose fewer pages." }
          mapOf("text" to result.text, "page" to page)
        } finally { recognizer.close() }
      } finally { bitmap.recycle() }
    } }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("renderPdfPage") { uri: String, page: Int, format: String -> synchronized(workLock) {
      require(format == "jpg" || format == "png") { "Choose JPG or PNG." }
      val output = temporary(format)
      val bitmap = renderPage(uri, page, 2400)
      try {
        FileOutputStream(output).use { stream ->
          check(bitmap.compress(if (format == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 94, stream)) { "The page image could not be written." }
        }
        require(output.length() in 1..(30L * 1024 * 1024)) { "The page image exceeds 30 MiB." }
        mapOf("uri" to Uri.fromFile(output).toString(), "width" to bitmap.width, "height" to bitmap.height, "size" to output.length())
      } catch (error: Exception) { output.delete(); throw error }
      finally { bitmap.recycle() }
    } }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("textToPdf") { text: String, size: Double -> synchronized(workLock) {
      makeTextPdf(text, size)
    } }.runOnQueue(Queues.DEFAULT)

    // Streams an app-owned copy into a document the caller already created through the
    // Storage Access Framework. JS otherwise has to hold the whole file as a base64
    // string, which is roughly 1.33x the file in memory on top of the file itself.
    AsyncFunction("writeToDocument") { sourceUri: String, documentUri: String -> synchronized(workLock) {
      val file = localFile(sourceUri, 100L * 1024 * 1024)
      val target = Uri.parse(documentUri)
      require(target.scheme == "content") { "Choose a folder on your phone." }
      var written = 0L
      context.contentResolver.openOutputStream(target, "wt").use { stream ->
        requireNotNull(stream) { "That folder could not be opened for writing." }
        file.inputStream().use { input -> written = input.copyTo(stream, 128 * 1024) }
        stream.flush()
      }
      require(written == file.length()) { "The copy was incomplete." }
      mapOf("size" to written)
    } }.runOnQueue(Queues.DEFAULT)
  }

  private fun localFile(value: String, maximum: Long = 30L * 1024 * 1024): File {
    val uri = Uri.parse(value)
    require(uri.scheme == "file") { "Open a local app copy first." }
    val file = File(requireNotNull(uri.path)).canonicalFile
    val roots = listOf(context.filesDir.canonicalPath, context.cacheDir.canonicalPath)
    require(roots.any { file.path.startsWith(it + File.separator) }) { "Only app-owned copies can be processed." }
    require(file.isFile && file.length() in 1..maximum) { "This file is missing, empty or too large." }
    return file
  }

  private fun temporary(extension: String): File {
    val directory = File(context.cacheDir, "file-tools").apply { mkdirs() }
    require(directory.usableSpace > 32L * 1024 * 1024) { "Free some device storage and try again." }
    val cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000
    directory.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
    return File(directory, "${UUID.randomUUID()}.$extension")
  }

  private fun <T> withPdf(uri: String, body: (PdfRenderer) -> T): T {
    val file = localFile(uri, 25L * 1024 * 1024)
    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
      PdfRenderer(descriptor).use { renderer -> return body(renderer) }
    }
  }

  private fun renderPage(uri: String, number: Int, edge: Int): Bitmap = withPdf(uri) { renderer ->
    require(number in 1..renderer.pageCount) { "That PDF page does not exist." }
    renderer.openPage(number - 1).use { page ->
      require(page.width > 0 && page.height > 0) { "This PDF page has invalid dimensions." }
      val scale = edge.toDouble() / max(page.width, page.height)
      val width = max(1, (page.width * scale).roundToInt())
      val height = max(1, (page.height * scale).roundToInt())
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      try {
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        bitmap
      } catch (error: Exception) { bitmap.recycle(); throw error }
    }
  }

  // JS normalizes EXIF orientation before calling this method. Decode remains
  // bounded here as well, so a caller cannot accidentally allocate a full camera image.
  private fun decodeImage(uri: String): Bitmap {
    val file = localFile(uri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "The image could not be decoded." }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight).toLong() / sample > 2400) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }
    return requireNotNull(BitmapFactory.decodeFile(file.path, options)) { "The image could not be read." }
  }

  private fun makeTextPdf(text: String, requestedSize: Double): Map<String, Any> {
    require(text.isNotBlank()) { "There is no text to turn into a PDF." }
    require(text.length <= 500000 && text.toByteArray(Charsets.UTF_8).size <= 1024 * 1024) { "Split this text into smaller documents." }
    require(requestedSize.isFinite()) { "Choose a valid font size." }
    val fontSize = requestedSize.coerceIn(8.0, 24.0).toFloat()
    val content = text.replace("\r\n", "\n").replace('\r', '\n').replace("\t", "    ")
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(24, 40, 36); textSize = fontSize; typeface = Typeface.create("sans-serif", Typeface.NORMAL) }
    val builder = StaticLayout.Builder.obtain(content, 0, content.length, paint, 511)
      .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(true)
      .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_LTR)
      .setLineSpacing(fontSize * 0.45f, 1f).setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY)
      .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
    if (Build.VERSION.SDK_INT >= 28) builder.setUseLineSpacingFromFallbacks(true)
    val layout = builder.build()
    val output = temporary("pdf")
    val document = PdfDocument()
    var line = 0
    var pageCount = 0
    try {
      while (line < layout.lineCount) {
        require(pageCount < 250) { "This document exceeds 250 pages. Split the text into smaller files." }
        val top = layout.getLineTop(line)
        var end = line
        while (end + 1 < layout.lineCount && layout.getLineBottom(end + 1) - top <= 758) end++
        val bottom = layout.getLineBottom(end)
        val page = document.startPage(PdfDocument.PageInfo.Builder(595, 842, ++pageCount).create())
        try {
          page.canvas.drawColor(Color.WHITE)
          page.canvas.save()
          page.canvas.translate(42f, 42f - top)
          page.canvas.clipRect(0, top, 511, bottom)
          layout.draw(page.canvas)
          page.canvas.restore()
        } finally { document.finishPage(page) }
        line = end + 1
      }
      FileOutputStream(output).use { document.writeTo(it) }
      require(output.length() in 1..(25L * 1024 * 1024)) { "The generated PDF exceeds 25 MiB. Use less text." }
      return mapOf("uri" to Uri.fromFile(output).toString(), "pageCount" to pageCount, "size" to output.length())
    } catch (error: Exception) { output.delete(); throw error }
    finally { document.close() }
  }
}
