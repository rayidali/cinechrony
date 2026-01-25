/**
 * Image processing utilities for iOS compatibility.
 *
 * iOS cameras capture photos in HEIC format by default, which most browsers
 * cannot display. This utility converts any image (including HEIC) to JPEG
 * using Canvas, which:
 * - Normalizes format to universally-supported JPEG
 * - Handles EXIF rotation automatically
 * - Resizes large images to reasonable dimensions
 * - Significantly reduces file size
 */

export interface ProcessedImage {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

export interface ProcessImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

const DEFAULT_OPTIONS: Required<ProcessImageOptions> = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.85,
  outputType: 'image/jpeg',
};

/**
 * Process an image file: decode (including HEIC), resize, and convert to JPEG.
 *
 * This function uses Canvas which:
 * 1. Can decode HEIC on iOS Safari (the only browser that supports camera upload)
 * 2. Automatically handles EXIF rotation
 * 3. Allows resizing and format conversion
 *
 * @param file - The input image file (any format including HEIC)
 * @param options - Processing options (max dimensions, quality, output format)
 * @returns Promise<ProcessedImage> - Processed file and preview URL
 */
export async function processImage(
  file: File,
  options: ProcessImageOptions = {}
): Promise<ProcessedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    // Create a blob URL for the original file
    const originalUrl = URL.createObjectURL(file);

    // Load into an Image element
    const img = new Image();

    img.onload = () => {
      try {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;

        if (width > opts.maxWidth || height > opts.maxHeight) {
          const ratio = Math.min(
            opts.maxWidth / width,
            opts.maxHeight / height
          );
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Create canvas and draw the image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(originalUrl);
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw image (canvas automatically handles EXIF rotation in modern browsers)
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(originalUrl);

            if (!blob) {
              reject(new Error('Failed to convert image'));
              return;
            }

            // Determine file extension
            const ext = opts.outputType === 'image/png' ? 'png'
              : opts.outputType === 'image/webp' ? 'webp'
              : 'jpg';

            // Create a new File with processed image
            const baseName = file.name.replace(/\.[^.]+$/, '');
            const newFile = new File([blob], `${baseName}.${ext}`, {
              type: opts.outputType,
            });

            // Create preview URL from the processed blob
            const previewUrl = URL.createObjectURL(blob);

            resolve({
              file: newFile,
              previewUrl,
              width,
              height,
            });
          },
          opts.outputType,
          opts.quality
        );
      } catch (error) {
        URL.revokeObjectURL(originalUrl);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(originalUrl);
      reject(new Error('Failed to load image. The file may be corrupted or in an unsupported format.'));
    };

    // Start loading the image
    img.src = originalUrl;
  });
}

/**
 * Convert a File to base64 string (without data URL prefix).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
}

/**
 * Validate that a file is an image.
 * Note: file.type may be empty for some formats on iOS, so we also check extension.
 */
export function isImageFile(file: File): boolean {
  // Check MIME type
  if (file.type.startsWith('image/')) {
    return true;
  }

  // Fallback: check file extension for common image formats
  const ext = file.name.toLowerCase().split('.').pop();
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tiff'];
  return imageExtensions.includes(ext || '');
}
