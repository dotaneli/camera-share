/**
 * Expo config plugin: adds hardware camera zoom support to react-native-webrtc.
 *
 * Patches:
 *   Android: CameraCaptureController.java, GetUserMediaImpl.java, WebRTCModule.java
 *            + creates org/webrtc/Camera2Zoom.java
 *   iOS:     VideoCaptureController.h, VideoCaptureController.m, WebRTCModule+RTCMediaStream.m
 *
 * JS usage: NativeModules.WebRTCModule.mediaStreamTrackSetZoom(trackId, zoomLevel)
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function patchFile(filePath, searchStr, replaceStr, marker) {
  let content = fs.readFileSync(filePath, 'utf8');
  const check = marker || 'setZoom';
  if (content.includes(check)) {
    // Already patched
    return;
  }
  if (!content.includes(searchStr)) {
    throw new Error(`[withWebRTCZoom] Could not find patch point in ${filePath}:\n  "${searchStr.substring(0, 80)}..."`);
  }
  content = content.replace(searchStr, replaceStr);
  fs.writeFileSync(filePath, content);
}

module.exports = function withWebRTCZoom(config) {
  // Android patches
  config = withDangerousMod(config, ['android', (config) => {
    const webrtcRoot = path.resolve(config.modRequest.projectRoot, 'node_modules/react-native-webrtc');
    const androidSrc = path.join(webrtcRoot, 'android/src/main/java');

    // 1. Create Camera2Zoom.java helper (in org.webrtc package for access to internals)
    const zoomHelperDir = path.join(androidSrc, 'org/webrtc');
    const zoomHelperPath = path.join(zoomHelperDir, 'Camera2Zoom.java');
    if (!fs.existsSync(zoomHelperPath) || !fs.readFileSync(zoomHelperPath, 'utf8').includes('setZoom')) {
      fs.writeFileSync(zoomHelperPath, `package org.webrtc;

import android.content.Context;
import android.hardware.camera2.*;
import android.graphics.Rect;
import android.os.Build;
import android.util.Log;
import java.lang.reflect.Field;

public class Camera2Zoom {
    private static final String TAG = "Camera2Zoom";

    public static void setZoom(Camera2Capturer capturer, Context context, String cameraName, float zoomFactor) {
        try {
            // Access Camera2Session from Camera2Capturer via reflection
            Field sessionField = Camera2Capturer.class.getDeclaredField("currentSession");
            sessionField.setAccessible(true);
            Object camera2Session = sessionField.get(capturer);
            if (camera2Session == null) {
                Log.w(TAG, "No current camera session");
                return;
            }

            // Get CameraCaptureSession from Camera2Session
            Field csField = camera2Session.getClass().getDeclaredField("captureSession");
            csField.setAccessible(true);
            CameraCaptureSession captureSession = (CameraCaptureSession) csField.get(camera2Session);

            // Get Surface from Camera2Session
            Field surfaceField = camera2Session.getClass().getDeclaredField("surface");
            surfaceField.setAccessible(true);
            android.view.Surface surface = (android.view.Surface) surfaceField.get(camera2Session);

            if (captureSession == null || surface == null) {
                Log.w(TAG, "CaptureSession or surface is null");
                return;
            }

            CameraDevice device = captureSession.getDevice();
            CaptureRequest.Builder builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            builder.addTarget(surface);

            // Preserve standard camera settings
            builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
            builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            builder.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);

            // Apply zoom
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, zoomFactor);
            } else {
                // Fallback: SCALER_CROP_REGION for older Android
                CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
                CameraCharacteristics chars = cameraManager.getCameraCharacteristics(cameraName);
                Rect sensorRect = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
                if (sensorRect != null) {
                    int cropW = (int) (sensorRect.width() / zoomFactor);
                    int cropH = (int) (sensorRect.height() / zoomFactor);
                    int cropX = (sensorRect.width() - cropW) / 2;
                    int cropY = (sensorRect.height() - cropH) / 2;
                    builder.set(CaptureRequest.SCALER_CROP_REGION,
                        new Rect(cropX, cropY, cropX + cropW, cropY + cropH));
                }
            }

            captureSession.setRepeatingRequest(builder.build(), null, null);
            Log.i(TAG, "Zoom set to " + zoomFactor);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set zoom: " + e.getMessage(), e);
        }
    }
}
`);
    }

    // 2. Patch CameraCaptureController.java — add import first, then method
    const cccPath = path.join(androidSrc, 'com/oney/WebRTCModule/CameraCaptureController.java');
    patchFile(cccPath,
      'import org.webrtc.Camera2Helper;',
      'import org.webrtc.Camera2Helper;\nimport org.webrtc.Camera2Zoom;',
      'Camera2Zoom'
    );
    patchFile(cccPath,
      '    private void updateActualSize(',
      `    public void setZoom(double zoomFactor) {
        if (videoCapturer instanceof Camera2Capturer) {
            String[] deviceNames = cameraEnumerator.getDeviceNames();
            int idx = currentDeviceId != null ? Integer.parseInt(currentDeviceId) : 0;
            if (idx >= 0 && idx < deviceNames.length) {
                Camera2Zoom.setZoom((Camera2Capturer) videoCapturer, context, deviceNames[idx], (float) zoomFactor);
            }
        }
    }

    private void updateActualSize(`
    );

    // 3. Patch GetUserMediaImpl.java — add setZoom bridge
    const gumiPath = path.join(androidSrc, 'com/oney/WebRTCModule/GetUserMediaImpl.java');
    patchFile(gumiPath,
      '    /**\n     * Application/library-specific private members of local',
      `    void setZoom(String trackId, double zoomFactor) {
        TrackPrivate track = tracks.get(trackId);
        if (track != null && track.videoCaptureController instanceof CameraCaptureController) {
            ((CameraCaptureController) track.videoCaptureController).setZoom(zoomFactor);
        }
    }

    /**
     * Application/library-specific private members of local`
    );

    // 4. Patch WebRTCModule.java — expose to JS
    const wrtcPath = path.join(androidSrc, 'com/oney/WebRTCModule/WebRTCModule.java');
    patchFile(wrtcPath,
      '    @ReactMethod\n    public void peerConnectionSetConfiguration',
      `    @ReactMethod
    public void mediaStreamTrackSetZoom(String id, double zoomFactor) {
        ThreadUtils.runOnExecutor(() -> { getUserMediaImpl.setZoom(id, zoomFactor); });
    }

    @ReactMethod
    public void peerConnectionSetConfiguration`
    );

    return config;
  }]);

  // iOS patches
  config = withDangerousMod(config, ['ios', (config) => {
    const webrtcRoot = path.resolve(config.modRequest.projectRoot, 'node_modules/react-native-webrtc');
    const iosSrc = path.join(webrtcRoot, 'ios/RCTWebRTC');

    // 5. Patch VideoCaptureController.h — add setZoom declaration
    const vccHPath = path.join(iosSrc, 'VideoCaptureController.h');
    patchFile(vccHPath,
      '- (void)applyConstraints:(NSDictionary *)constraints error:(NSError **)outError;\n\n@end',
      `- (void)applyConstraints:(NSDictionary *)constraints error:(NSError **)outError;
- (void)setZoom:(CGFloat)zoomFactor;

@end`
    );

    // 6. Patch VideoCaptureController.m — add setZoom implementation
    const vccMPath = path.join(iosSrc, 'VideoCaptureController.m');
    patchFile(vccMPath,
      '- (void)resetFrameRateForDevice:(AVCaptureDevice *)device {',
      `- (void)setZoom:(CGFloat)zoomFactor {
    AVCaptureDevice *device = self.device;
    if (!device) return;

    NSError *error = nil;
    [device lockForConfiguration:&error];
    if (error) {
        RCTLog(@"[VideoCaptureController] Could not lock device for zoom: %@", error);
        return;
    }

    CGFloat maxZoom = device.activeFormat.videoMaxZoomFactor;
    CGFloat clampedZoom = MAX(1.0, MIN(zoomFactor, MIN(maxZoom, 10.0)));
    [device rampToVideoZoomFactor:clampedZoom withRate:8.0];

    [device unlockForConfiguration];
}

- (void)resetFrameRateForDevice:(AVCaptureDevice *)device {`
    );

    // 7. Patch WebRTCModule+RTCMediaStream.m — expose to JS
    const wrtcMPath = path.join(iosSrc, 'WebRTCModule+RTCMediaStream.m');
    patchFile(wrtcMPath,
      '#pragma mark - Helpers',
      `RCT_EXPORT_METHOD(mediaStreamTrackSetZoom:(nonnull NSString *)trackID zoom:(double)zoomFactor) {
#if !TARGET_OS_TV
    RTCMediaStreamTrack *track = self.localTracks[trackID];
    if (track && [track.kind isEqualToString:@"video"]) {
        RTCVideoTrack *videoTrack = (RTCVideoTrack *)track;
        if ([videoTrack.captureController isKindOfClass:[VideoCaptureController class]]) {
            VideoCaptureController *vcc = (VideoCaptureController *)videoTrack.captureController;
            [vcc setZoom:(CGFloat)zoomFactor];
        }
    }
#endif
}

#pragma mark - Helpers`
    );

    return config;
  }]);

  return config;
};
