import { useEffect, useState } from 'react'

/**
 * Photo capture and compression.
 *
 * A modern phone camera produces 4–8 MB per shot. A busy health post taking two
 * photos per consultation would fill the device's storage quota within weeks,
 * and every one of those bytes eventually has to cross a metered connection. So
 * images are downscaled and re-encoded on capture, before they ever reach the
 * database, the original is never stored.
 *
 * 1600px on the long edge keeps a handwritten register page legible, which is
 * the demanding case and the one that matters for OCR later.
 */

const MAX_EDGE = 1600
const QUALITY = 0.72

export interface CompressedImage {
  blob: Blob
  width: number
  height: number
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    // OffscreenCanvas keeps the resize off the main thread where it's supported,
    // which matters on the low-end devices this targets.
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height })

    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null
    if (!ctx) throw new Error('Canvas unavailable')

    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
        : await new Promise<Blob>((resolve, reject) => {
            ;(canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
              'image/jpeg',
              QUALITY,
            )
          })

    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}

/**
 * Object URL bound to a React lifecycle. Blob URLs leak until revoked, and a
 * roster of attachments would otherwise pin every image in memory.
 */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}
