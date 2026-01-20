package com.keymote.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

// ZXing Imports
import com.google.zxing.BinaryBitmap;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.io.InputStream;
import java.util.List;

/**
 * Custom Capacitor Plugin for Gallery QR Scanning using native ML Kit + ZXing
 * Fallback
 */
@CapacitorPlugin(name = "GalleryQrScanner")
public class GalleryQrScannerPlugin extends Plugin {

    private static final String TAG = "GalleryQrScanner";

    @PluginMethod
    public void scanFromGallery(PluginCall call) {
        saveCall(call);
        Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        intent.setType("image/*");
        startActivityForResult(call, intent, "handleGalleryResult");
    }

    @ActivityCallback
    private void handleGalleryResult(PluginCall call, ActivityResult result) {
        if (call == null)
            return;

        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.reject("No image selected");
            return;
        }

        Uri imageUri = data.getData();
        Log.d(TAG, "Image selected: " + imageUri.toString());

        try {
            // Copy to temp file first (Robust handling for all ContentProviders/Cloud)
            java.io.File tempFile = copyToTempFile(imageUri);
            if (tempFile == null) {
                call.reject("Failed to copy image from gallery");
                return;
            }

            // Decode from file with downsampling to avoid OOM
            Bitmap bitmap = decodeSampledBitmapFromFile(tempFile.getAbsolutePath(), 1500, 1500);

            if (bitmap == null) {
                // Try one more time without downsampling if it failed (fallback)
                Log.w(TAG, "Downsampled decode failed, trying standard decode...");
                bitmap = BitmapFactory.decodeFile(tempFile.getAbsolutePath());
            }

            if (bitmap == null) {
                call.reject("Failed to decode image. File size: " + tempFile.length() + " bytes");
                return;
            }

            // Handle EXIF rotation using the file
            int rotation = getRotationFromExif(tempFile.getAbsolutePath());
            if (rotation != 0) {
                Log.d(TAG, "Rotating bitmap by " + rotation + " degrees");
                bitmap = rotateBitmap(bitmap, rotation);
            }

            // Process with ML Kit
            processImageWithMLKit(call, bitmap);

            // Cleanup
            // tempFile.delete(); // Keep for now

        } catch (Exception e) {
            Log.e(TAG, "Error processing image", e);
            call.reject("Error processing image: " + e.getMessage());
        }
    }

    // Safe decoding helper
    private Bitmap decodeSampledBitmapFromFile(String path, int reqWidth, int reqHeight) {
        try {
            // First decode with inJustDecodeBounds=true to check dimensions
            final BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, options);

            // Calculate inSampleSize
            options.inSampleSize = calculateInSampleSize(options, reqWidth, reqHeight);

            // Decode bitmap with inSampleSize set
            options.inJustDecodeBounds = false;
            return BitmapFactory.decodeFile(path, options);
        } catch (Exception e) {
            Log.e(TAG, "Error in decodeSampledBitmapFromFile", e);
            return null;
        }
    }

    private int calculateInSampleSize(BitmapFactory.Options options, int reqWidth, int reqHeight) {
        final int height = options.outHeight;
        final int width = options.outWidth;
        int inSampleSize = 1;

        if (height > reqHeight || width > reqWidth) {
            final int halfHeight = height / 2;
            final int halfWidth = width / 2;

            // Calculate the largest inSampleSize value that is a power of 2 and keeps both
            // height and width larger than the requested height and width.
            while ((halfHeight / inSampleSize) >= reqHeight && (halfWidth / inSampleSize) >= reqWidth) {
                inSampleSize *= 2;
            }
        }
        return inSampleSize;
    }

    private java.io.File copyToTempFile(Uri uri) {
        try {
            InputStream inputStream = getActivity().getContentResolver().openInputStream(uri);
            if (inputStream == null)
                return null;

            java.io.File tempFile = new java.io.File(getActivity().getCacheDir(), "temp_qs_scan.jpg");
            if (tempFile.exists())
                tempFile.delete();

            java.io.FileOutputStream outputStream = new java.io.FileOutputStream(tempFile);
            byte[] buffer = new byte[8 * 1024]; // 8k buffer
            int read;
            while ((read = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, read);
            }
            outputStream.flush();
            outputStream.close();
            inputStream.close();
            Log.d(TAG,
                    "Copied image to temp file: " + tempFile.getAbsolutePath() + " (" + tempFile.length() + " bytes)");
            return tempFile;
        } catch (java.io.IOException e) {
            Log.e(TAG, "Failed to copy file", e);
            return null;
        }
    }

    private int getRotationFromExif(String filePath) {
        try {
            androidx.exifinterface.media.ExifInterface exif = new androidx.exifinterface.media.ExifInterface(filePath);
            int orientation = exif.getAttributeInt(androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION,
                    androidx.exifinterface.media.ExifInterface.ORIENTATION_NORMAL);
            switch (orientation) {
                case androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_90:
                    return 90;
                case androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_180:
                    return 180;
                case androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_270:
                    return 270;
                default:
                    return 0;
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read EXIF", e);
            return 0;
        }
    }

    private Bitmap rotateBitmap(Bitmap bitmap, int degrees) {
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }

    private void processImageWithMLKit(PluginCall call, Bitmap originalBitmap) {
        int width = originalBitmap.getWidth();
        int height = originalBitmap.getHeight();
        Log.d(TAG, "Processing image with ML Kit/ZXing... Size: " + width + "x" + height);

        // Strategy 1: QR_CODE (ML Kit)
        scanBitmap(originalBitmap, Barcode.FORMAT_QR_CODE, (found1, data1) -> {
            if (found1) {
                returnSuccess(call, data1, width, height, "Strategy 1: ML Kit QR");
                return;
            }

            // Strategy 2: ALL_FORMATS (ML Kit)
            scanBitmap(originalBitmap, Barcode.FORMAT_ALL_FORMATS, (found2, data2) -> {
                if (found2) {
                    returnSuccess(call, data2, width, height, "Strategy 2: ML Kit All");
                    return;
                }

                // Strategy 3: Scaled Down (ML Kit)
                if (width > 1200 || height > 1200) {
                    Bitmap scaledBitmap = scaleBitmap(originalBitmap, 1200);
                    scanBitmap(scaledBitmap, Barcode.FORMAT_ALL_FORMATS, (found3, data3) -> {
                        if (found3) {
                            returnSuccess(call, data3, width, height, "Strategy 3: ML Kit Scaled");
                        } else {
                            // Strategy 4: ZXing Fallback
                            scanWithZXing(call, originalBitmap, width, height);
                        }
                    });
                } else {
                    // Strategy 4: ZXing Fallback
                    scanWithZXing(call, originalBitmap, width, height);
                }
            });
        });
    }

    private void scanWithZXing(PluginCall call, Bitmap bitmap, int w, int h) {
        Log.d(TAG, "Strategies 1-3 failed. Trying Strategy 4: ZXing...");
        try {
            int[] intArray = new int[bitmap.getWidth() * bitmap.getHeight()];
            bitmap.getPixels(intArray, 0, bitmap.getWidth(), 0, 0, bitmap.getWidth(), bitmap.getHeight());
            RGBLuminanceSource source = new RGBLuminanceSource(bitmap.getWidth(), bitmap.getHeight(), intArray);
            BinaryBitmap binaryBitmap = new BinaryBitmap(new HybridBinarizer(source));

            Result result = new MultiFormatReader().decode(binaryBitmap);

            if (result != null) {
                returnSuccess(call, result.getText(), w, h, "Strategy 4: ZXing Fallback");
            } else {
                returnFailure(call, w, h, "All 4 strategies failed (ML Kit + ZXing)");
            }
        } catch (Exception e) {
            Log.e(TAG, "ZXing failed", e);
            returnFailure(call, w, h, "All strategies failed (ML Kit + ZXing error: " + e.getMessage() + ")");
        }
    }

    private void scanBitmap(Bitmap bitmap, int format, ScanCallback callback) {
        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(format)
                .build();
        BarcodeScanner scanner = BarcodeScanning.getClient(options);
        InputImage image = InputImage.fromBitmap(bitmap, 0);

        scanner.process(image)
                .addOnSuccessListener(barcodes -> {
                    if (!barcodes.isEmpty()) {
                        callback.onScanComplete(true, barcodes.get(0).getRawValue());
                    } else {
                        callback.onScanComplete(false, null);
                    }
                })
                .addOnFailureListener(e -> callback.onScanComplete(false, null));
    }

    private Bitmap scaleBitmap(Bitmap bitmap, int maxDimension) {
        int originalWidth = bitmap.getWidth();
        int originalHeight = bitmap.getHeight();
        int newWidth = originalWidth;
        int newHeight = originalHeight;

        if (originalWidth > maxDimension || originalHeight > maxDimension) {
            float ratio = Math.min((float) maxDimension / originalWidth, (float) maxDimension / originalHeight);
            newWidth = Math.round(originalWidth * ratio);
            newHeight = Math.round(originalHeight * ratio);
        }

        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true);
    }

    private void returnSuccess(PluginCall call, String data, int w, int h, String debugInfo) {
        Log.d(TAG, "Scan Success via " + debugInfo + ": " + data);
        JSObject ret = new JSObject();
        ret.put("found", true);
        ret.put("data", data);
        ret.put("imageWidth", w);
        ret.put("imageHeight", h);
        ret.put("debug", "Found via " + debugInfo);
        call.resolve(ret);
    }

    private void returnFailure(PluginCall call, int w, int h, String debugInfo) {
        Log.d(TAG, "Scan Failure: " + debugInfo);
        JSObject ret = new JSObject();
        ret.put("found", false);
        ret.put("imageWidth", w);
        ret.put("imageHeight", h);
        ret.put("debug", debugInfo);
        call.resolve(ret);
    }

    interface ScanCallback {
        void onScanComplete(boolean found, String data);
    }
}
