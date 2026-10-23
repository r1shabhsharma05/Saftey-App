// 🛡️ Avatar upload validation — client-side trust boundary for the
// private `avatars` bucket. A picker result comes from the OS media
// library, and its `uri`/`fileSize`/extension are NOT proof of a real
// image: enforce a size cap BEFORE buffering the file into memory, then
// verify the actual bytes (magic numbers). A renamed binary must never
// land in the bucket as avatar.jpg.
//
// No imports on purpose: this file is compiled standalone for the node
// unit test (see the Day 5 daily report), so it must stay dependency-free.
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

// Sniffs the magic bytes of the image types expo-image-picker can hand
// us. Returns the real MIME type, or null when the bytes are not a
// known image. The extension proves nothing — check the bytes.
export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  // GIF: 47 49 46 38 ("GIF8")
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return "image/gif";
  // WebP: "RIFF" <4 size bytes> "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}
