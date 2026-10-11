import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { HEADER_BYTES, WORKING_IMAGE_EDGE, inspectImageHeader } from './imageSafety.cjs';
import { LIMITS } from './fileUtils.cjs';

export function inspectImageFile(uri) {
  if (!/^(file|content):\/\//i.test(uri || '')) throw new Error('Only local images are supported.');
  const file = new File(uri);
  if (!file.exists || file.size < 1 || file.size > LIMITS.image) throw new Error('Choose an available image under 30 MiB.');
  const handle = file.open();
  try { return inspectImageHeader(handle.readBytes(Math.min(file.size, HEADER_BYTES))); }
  finally { handle.close(); }
}

// Glide's native centerInside + submit(maxWidth,maxHeight) requests a sampled
// decode BEFORE manipulation, rather than resizing a full-size bitmap afterward.
export async function loadBoundedImage(uri, edge = WORKING_IMAGE_EDGE) {
  if (!Number.isInteger(edge) || edge < 1 || edge > WORKING_IMAGE_EDGE) throw new Error('Invalid image decode limit.');
  const metadata = inspectImageFile(uri);
  const ref = await Image.loadAsync({ uri }, { maxWidth: edge, maxHeight: edge });
  const width = Math.round(ref.width * (ref.scale || 1)), height = Math.round(ref.height * (ref.scale || 1));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > edge || height > edge || ref.isAnimated) {
    ref.release();
    throw new Error('The device could not decode this image within the safe limit. Use a smaller static image.');
  }
  return { ref, metadata, width, height };
}
