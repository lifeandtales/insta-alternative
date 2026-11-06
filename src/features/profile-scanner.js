import { getAccount } from '../core/social.js';
import { state } from '../core/state.js';
import { setView } from '../core/navigation.js';

let stream = null, frame = null, generation = 0;

export function profileHandleFromQr(value, base = window.location.href) {
    let url, home;
    try { url = new URL(value); home = new URL(base); } catch { return null; }
    // Only route this app's profile links; never open arbitrary scanned URLs.
    if (url.origin !== home.origin || url.pathname !== home.pathname) return null;
    const match = /^#profile-(.+)$/.exec(url.hash);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function stopProfileScanner() {
    generation++;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    const video = document.querySelector('.profile-scanner-video');
    if (video) { video.pause(); video.srcObject = null; video.hidden = true; }
}

function acceptCode(value) {
    const handle = profileHandleFromQr(value);
    const status = document.querySelector('.profile-scanner-status');
    if (!handle) { status.textContent = 'This is not an Insta Alternative profile QR code.'; return false; }
    if (!getAccount(handle)) { status.textContent = 'This profile is not available in this preview.'; return false; }
    stopProfileScanner();
    document.querySelector('.profile-scanner-dialog').close();
    state.profileHandle = handle; state.activeProfileSection = 'posts'; setView('profile');
    return true;
}

export function openProfileScanner() {
    stopProfileScanner();
    const dialog = document.querySelector('.profile-scanner-dialog');
    dialog.querySelector('.profile-scanner-status').textContent = 'Start the camera or choose a QR image.';
    dialog.querySelector('input').value = '';
    dialog.showModal();
}

export async function startProfileScanCamera() {
    stopProfileScanner(); const request = generation;
    const status = document.querySelector('.profile-scanner-status');
    if (!navigator.mediaDevices?.getUserMedia) { status.textContent = 'Camera unavailable. Choose a QR image instead.'; return; }
    status.textContent = 'Allow camera access to scan a profile QR code.';
    try {
        const decoder = (await import('../vendor/jsqr.js')).default;
        if (request !== generation) return;
        const next = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        if (request !== generation) { next.getTracks().forEach(track => track.stop()); return; }
        stream = next;
        const video = document.querySelector('.profile-scanner-video'); video.srcObject = next; video.hidden = false;
        await video.play();
        if (request !== generation) return;
        status.textContent = 'Point the camera at a profile QR code.';
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d', {willReadFrequently:true});
        let last = 0;
        const scan = time => {
            if (request !== generation) return;
            if (video.readyState >= 2 && video.videoWidth && time-last > 180) {
                last = time; const ratio = Math.min(1, 720/video.videoWidth);
                canvas.width = Math.round(video.videoWidth*ratio); canvas.height = Math.round(video.videoHeight*ratio);
                context.drawImage(video,0,0,canvas.width,canvas.height);
                const pixels = context.getImageData(0,0,canvas.width,canvas.height);
                const result = decoder(pixels.data,canvas.width,canvas.height);
                if (result && acceptCode(result.data)) return;
            }
            frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
    } catch(error) {
        if (request !== generation) return;
        stopProfileScanner();
        status.textContent = error.name === 'NotAllowedError' ? 'Camera access was denied. Choose a QR image instead.' : 'Camera could not start. Choose a QR image instead.';
    }
}

export async function scanProfileQrImage(file) {
    if (!file) return;
    stopProfileScanner(); const request = generation;
    const status = document.querySelector('.profile-scanner-status'); status.textContent = 'Reading QR image…';
    let objectUrl;
    try {
        const decoder = (await import('../vendor/jsqr.js')).default;
        const image = new Image(); objectUrl = URL.createObjectURL(file);
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=objectUrl;});
        if (request !== generation) return;
        const ratio = Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas = document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
        const context=canvas.getContext('2d');context.drawImage(image,0,0,canvas.width,canvas.height);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height),result=decoder(pixels.data,canvas.width,canvas.height);
        if (result) acceptCode(result.data);else status.textContent='No QR code found. Try a clearer image.';
    } catch { if(request===generation)status.textContent='This image could not be read. Try another QR image.'; }
    finally { if(objectUrl)URL.revokeObjectURL(objectUrl); }
}

export function registerProfileScannerEvents() {
    const dialog=document.querySelector('.profile-scanner-dialog');
    dialog.addEventListener('close',stopProfileScanner);
    dialog.addEventListener('cancel',stopProfileScanner);
    dialog.addEventListener('click',event=>{
        if(event.target===dialog||event.target.closest('[data-close-profile-scanner]')){stopProfileScanner();dialog.close();}
        if(event.target.closest('[data-start-profile-camera]'))startProfileScanCamera();
    });
    dialog.querySelector('input').addEventListener('change',event=>scanProfileQrImage(event.target.files?.[0]));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopProfileScanner();});
}
