let cameraStream = null;
let cameraFacingMode = 'environment';
let cameraRequest = 0;
let recorder = null;
let recordingAudioStream = null;
let recordingTimeout = null;

const STORY_CAMERA_VIDEO_LIMIT_MS = 240000;

export async function openStoryCamera(video) {
    const getUserMedia = navigator.mediaDevices?.getUserMedia;
    if (typeof getUserMedia !== 'function') throw new Error('unavailable');
    stopStoryCamera();
    const request = ++cameraRequest;
    const stream = await getUserMedia.call(navigator.mediaDevices, {
        video: { facingMode: { ideal: cameraFacingMode } },
        audio: false
    });
    if (request !== cameraRequest) {
        stream.getTracks().forEach(track => track.stop());
        return null;
    }
    cameraStream = stream;
    video.srcObject = cameraStream;
    const playback = video.play?.();
    playback?.catch?.(() => {});
    return cameraStream;
}

export async function switchStoryCamera(video) {
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    return openStoryCamera(video);
}

export function stopStoryCamera() {
    cameraRequest++;
    stopStoryVideoRecording();
    recordingAudioStream?.getTracks().forEach(track => track.stop());
    recordingAudioStream = null;
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
}

export async function captureStoryPhoto(video) {
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) throw new Error('not-ready');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('unavailable');
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
        image => image ? resolve(image) : reject(new Error('capture-failed')),
        'image/jpeg', .92
    ));
    return { type: 'image', media: URL.createObjectURL(blob), durationMs: 30000 };
}

function cameraVideoMimeType() {
    if (typeof MediaRecorder?.isTypeSupported !== 'function') return '';
    return [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4',
        'video/webm;codecs=vp8,opus', 'video/webm'
    ].find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export async function startStoryVideoRecording({ onStarted = () => {} } = {}) {
    if (!cameraStream?.getVideoTracks?.().length || typeof MediaRecorder !== 'function' || typeof MediaStream !== 'function')
        throw new Error('unsupported');
    const activeCameraStream = cameraStream;
    const getUserMedia = navigator.mediaDevices?.getUserMedia;
    if (typeof getUserMedia !== 'function') throw new Error('microphone-unavailable');
    const audioStream = await getUserMedia.call(navigator.mediaDevices, { audio: true, video: false });
    if (cameraStream !== activeCameraStream) {
        audioStream.getTracks().forEach(track => track.stop());
        throw new Error('cancelled');
    }
    recordingAudioStream = audioStream;
    const tracks = [...activeCameraStream.getVideoTracks(), ...recordingAudioStream.getAudioTracks()];
    if (!tracks.some(track => track.kind === 'audio')) {
        recordingAudioStream.getTracks().forEach(track => track.stop());
        recordingAudioStream = null;
        throw new Error('microphone-unavailable');
    }
    const stream = new MediaStream(tracks), mimeType = cameraVideoMimeType();
    try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
        recordingAudioStream.getTracks().forEach(track => track.stop());
        recordingAudioStream = null;
        recorder = null;
        throw new Error('unsupported');
    }
    const activeRecorder = recorder, chunks = [], startedAt = Date.now();
    return new Promise((resolve, reject) => {
        activeRecorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data); });
        activeRecorder.addEventListener('error', () => {
            clearTimeout(recordingTimeout);recordingTimeout = null;
            recordingAudioStream?.getTracks().forEach(track => track.stop());recordingAudioStream = null;recorder = null;
            if (activeRecorder.state !== 'inactive') activeRecorder.stop();
            reject(new Error('recording-failed'));
        }, { once: true });
        activeRecorder.addEventListener('stop', () => {
            clearTimeout(recordingTimeout);recordingTimeout = null;
            recordingAudioStream?.getTracks().forEach(track => track.stop());recordingAudioStream = null;recorder = null;
            const type = activeRecorder.mimeType || mimeType || chunks[0]?.type || 'video/webm';
            const blob = new Blob(chunks, { type });
            if (!blob.size) { reject(new Error('empty-recording'));return; }
            resolve({ type: 'video', media: URL.createObjectURL(blob), durationMs: Math.min(STORY_CAMERA_VIDEO_LIMIT_MS, Date.now() - startedAt) });
        }, { once: true });
        try {
            activeRecorder.start(1000);
            recordingTimeout = setTimeout(() => stopStoryVideoRecording(), STORY_CAMERA_VIDEO_LIMIT_MS);
            onStarted();
        } catch {
            recordingAudioStream?.getTracks().forEach(track => track.stop());recordingAudioStream = null;recorder = null;
            reject(new Error('recording-failed'));
        }
    });
}

export function stopStoryVideoRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
}
