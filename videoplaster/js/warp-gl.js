// videoplaster/js/warp-gl.js
import { computeH, inv3 } from "./homography.ts";
const VS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.,1.); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform mat3 u_Hinv; uniform vec2 u_res; varying vec2 v_uv;
void main(){ vec2 fp=vec2(v_uv.x*u_res.x,(1.0-v_uv.y)*u_res.y); vec3 h=u_Hinv*vec3(fp,1.0); vec2 sp=h.xy/h.z;
  vec2 uv=vec2(sp.x/u_res.x,1.0-sp.y/u_res.y);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) gl_FragColor=vec4(0,0,0,1); else gl_FragColor=texture2D(u_tex,uv); }`;

// Pure: destination corner positions = base corners + per-corner pixel offsets.
export function cornerPositions(w, h, off) {
  return {
    tl: { x: 0 + off.tl.x, y: 0 + off.tl.y },
    tr: { x: w + off.tr.x, y: 0 + off.tr.y },
    br: { x: w + off.br.x, y: h + off.br.y },
    bl: { x: 0 + off.bl.x, y: h + off.bl.y },
  };
}

function mk(gl, t, s) {
  const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("warp shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export class WarpGL {
  constructor(gl, w, h){ this.gl=gl; this.w=w; this.h=h;
    this.prog=gl.createProgram(); gl.attachShader(this.prog,mk(gl,gl.VERTEX_SHADER,VS));
    gl.attachShader(this.prog,mk(gl,gl.FRAGMENT_SHADER,FS)); gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error("warp link: " + gl.getProgramInfoLog(this.prog));
    this.quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    this.uHinv=gl.getUniformLocation(this.prog,"u_Hinv"); this.uRes=gl.getUniformLocation(this.prog,"u_res");
    // per-corner pixel offsets from the base corners; all zero = identity (no keystone)
    this.off={ tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0} }; }
  setPinOffset(k, axis, v){ this.off[k][axis]=v; }
  resize(w, h){ this.w=w; this.h=h; }
  cornerPositions(){ return cornerPositions(this.w, this.h, this.off); }
  draw(srcTex){ const gl=this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.w,this.h);
    gl.useProgram(this.prog); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const loc=gl.getAttribLocation(this.prog,"a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const src=[{x:0,y:0},{x:this.w,y:0},{x:this.w,y:this.h},{x:0,y:this.h}];
    const c=this.cornerPositions();
    const dst=[c.tl,c.tr,c.br,c.bl];
    const H=computeH(src,dst), Hi=inv3(H);
    gl.uniformMatrix3fv(this.uHinv,false,[Hi[0],Hi[3],Hi[6],Hi[1],Hi[4],Hi[7],Hi[2],Hi[5],Hi[8]]);
    gl.uniform2f(this.uRes,this.w,this.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,srcTex);
    gl.uniform1i(gl.getUniformLocation(this.prog,"u_tex"),0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4); }
}
