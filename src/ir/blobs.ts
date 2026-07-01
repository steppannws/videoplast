// src/ir/blobs.ts
import type { DetOpt, DetBlob } from "../types/index.ts";

// Only the fields findBlobs actually consumes. Decoupled from the full DetOpt so
// adding calibration options (brightness, motion, …) never churns findBlobs' callers.
export type BlobOpt = Pick<DetOpt, "threshold" | "minArea" | "maxArea" | "blurAmt" | "erosionAmt" | "invert">;

export function boxBlur(g: Float32Array, w: number, h: number, r: number): Float32Array {
  if (!r) return g; const t = new Float32Array(w*h), o = new Float32Array(w*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let s=0; for(let dx=-r;dx<=r;dx++){const nx=Math.max(0,Math.min(w-1,x+dx)); s+=g[y*w+nx];} t[y*w+x]=s/(2*r+1); }
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let s=0; for(let dy=-r;dy<=r;dy++){const ny=Math.max(0,Math.min(h-1,y+dy)); s+=t[ny*w+x];} o[y*w+x]=s/(2*r+1); }
  return o;
}
export function morphErode(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (!r) return bin; const out = new Uint8Array(w*h);
  for (let y=r;y<h-r;y++) for (let x=r;x<w-r;x++){ if(!bin[y*w+x])continue; let ok=true;
    for(let d=1;d<=r&&ok;d++) if(!bin[y*w+(x-d)]||!bin[y*w+(x+d)]||!bin[(y-d)*w+x]||!bin[(y+d)*w+x]) ok=false;
    if(ok) out[y*w+x]=1; } return out;
}
export function morphDilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (!r) return bin; const out = new Uint8Array(w*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ if(bin[y*w+x]){out[y*w+x]=1;continue;} let f=false;
    for(let d=1;d<=r&&!f;d++) if((x-d>=0&&bin[y*w+(x-d)])||(x+d<w&&bin[y*w+(x+d)])||(y-d>=0&&bin[(y-d)*w+x])||(y+d<h&&bin[(y+d)*w+x])) f=true;
    if(f) out[y*w+x]=1; } return out;
}
export function grayscaleFromRGBA(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) g[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
  return g;
}
// frame = {data:RGBA Uint8ClampedArray, width, height}
export function findBlobs(frame: { data: Uint8ClampedArray; width: number; height: number }, opt: BlobOpt): { blobs: DetBlob[]; bin: Uint8Array } {
  const { width: w, height: h, data } = frame;
  const { threshold, minArea, maxArea, blurAmt, erosionAmt, invert } = opt;
  const gray = grayscaleFromRGBA(data, w, h);
  const bl = boxBlur(gray, w, h, blurAmt);
  let bin: Uint8Array = new Uint8Array(w*h);
  for (let i=0;i<w*h;i++){ const v=bl[i]; bin[i]= invert ? (v<threshold?1:0) : (v>threshold?1:0); }
  if (erosionAmt>0){ bin=morphErode(bin,w,h,erosionAmt); bin=morphDilate(bin,w,h,erosionAmt); }
  const vis=new Uint8Array(w*h), blobs: DetBlob[]=[];
  for (let s=0;s<w*h;s++){ if(!bin[s]||vis[s])continue;
    const stk: number[]=[s]; vis[s]=1; let sx=0,sy=0,area=0,sumv=0;
    while(stk.length){ const idx=stk.pop()!, px=idx%w, py=(idx/w)|0; sx+=px; sy+=py; area++; sumv+=bl[idx];
      if(px>0&&bin[idx-1]&&!vis[idx-1]){vis[idx-1]=1;stk.push(idx-1);}
      if(px<w-1&&bin[idx+1]&&!vis[idx+1]){vis[idx+1]=1;stk.push(idx+1);}
      if(py>0&&bin[idx-w]&&!vis[idx-w]){vis[idx-w]=1;stk.push(idx-w);}
      if(py<h-1&&bin[idx+w]&&!vis[idx+w]){vis[idx+w]=1;stk.push(idx+w);} }
    if(area>=minArea&&area<=maxArea) blobs.push({ cx:sx/area, cy:sy/area, area, bright:sumv/area }); }
  return { blobs, bin };
}
