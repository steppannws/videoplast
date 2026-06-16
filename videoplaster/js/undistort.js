// videoplaster/js/undistort.js  (ported from v11, unchanged logic)
export function buildUndistMap(w, h, k1, k2) {
  const map = new Int16Array(w*h*2), cx=w/2, cy=h/2, f=Math.max(w,h)/2;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const nx=(x-cx)/f, ny=(y-cy)/f, r2=nx*nx+ny*ny, fac=1+k1*r2+k2*r2*r2, si=(y*w+x)*2;
    map[si]=Math.round(nx*fac*f+cx); map[si+1]=Math.round(ny*fac*f+cy);
  }
  return map;
}
export function applyUndist(data, w, h, map) {
  const dst = new Uint8ClampedArray(w*h*4);
  for (let i=0;i<w*h;i++){ const sx=map[i*2], sy=map[i*2+1];
    if(sx>=0&&sx<w&&sy>=0&&sy<h){ const di=i*4, si=(sy*w+sx)*4; dst[di]=data[si]; dst[di+1]=data[si+1]; dst[di+2]=data[si+2]; dst[di+3]=255; } }
  return dst;
}
