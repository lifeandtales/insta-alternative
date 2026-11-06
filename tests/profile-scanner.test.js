import test from 'node:test';
import assert from 'node:assert/strict';
import qrcode from '../src/vendor/qrcode.js';
import jsQR from '../src/vendor/jsqr.js';
import { loadApp } from './helpers/app-harness.js';

test('generated profile QR decodes to the same profile URL',()=>{
 const url='https://lifeandtales.github.io/insta-alternative/#profile-%40mila_rose';
 const qr=qrcode(0,'M');qr.addData(url);qr.make();
 const cell=6,border=4,size=(qr.getModuleCount()+border*2)*cell;
 const pixels=new Uint8ClampedArray(size*size*4).fill(255);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const row=Math.floor(y/cell)-border,col=Math.floor(x/cell)-border;
  if(row>=0&&col>=0&&row<qr.getModuleCount()&&col<qr.getModuleCount()&&qr.isDark(row,col)){
   const i=(y*size+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;
  }
 }
 assert.equal(jsQR(pixels,size,size)?.data,url);
});
test('scanner accepts app profile links and rejects other sites, paths and malformed payloads',async()=>{
 const app=await loadApp();const {profileHandleFromQr}=app.exportsOf('src/features/profile-scanner.js');
 const base='https://lifeandtales.github.io/insta-alternative/';
 assert.equal(profileHandleFromQr(base+'#profile-%40aribloom',base),'@aribloom');
 for(const value of ['javascript:alert(1)','https://other.example/#profile-a',base+'#post-1',base+'#profile-%E0%A4%A','https://lifeandtales.github.io/other/#profile-a'])assert.equal(profileHandleFromQr(value,base),null);
});
