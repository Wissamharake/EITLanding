// Smooth laser "handwriting": continuous beam motion + persistent white letters (no fade).
// Fixes jerkiness by interpolating along segments and drawing a continuous tip trajectory.

const TEXT = "Welcome to Electrical & Instrumentation Dashboard";

const CONFIG = {
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  fontWeight: 750,
  fontScale: 0.082,
  lineHeight: 1.15,
  maxLineWidthRatio: 0.86,

  // Sampling density (lower = more points, smoother but heavier)
  sampleStep: 1,

  // Continuous motion speed (points/sec along sampled points)
  pointsPerSecond: 2000,

  // Beam look
  coreWidth: 1.4,
  midWidth: 4.2,
  outerWidth: 11.0,
  coreAlpha: 0.95,
  midAlpha: 0.24,
  outerAlpha: 0.12,
  outerBlur: 18,
  midBlur: 8,
  coreBlur: 2,
  hotspotRadius: 3.6,
  hotspotGlow: 22,

  // Text permanence
  textDotRadius: 1.05,
  textHardAlpha: 1.0,
  textSoftGlowAlpha: 0.12,
  textGlowRadius: 7.5,

  // Beam tail
  tailLength: 60,      // number of past tip positions
  tailStepMin: 1.4,    // min px distance between stored tip positions (reduces noise)

  // Background
  blobStrength: 0.28,

  // Colors
  textWhite: [255,255,255],
  beamRed:   [255,70,70],
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

let w=0,h=0,dpr=1;

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rnd(a,b){ return a + Math.random()*(b-a); }
function rgba(rgb,a){ return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }
function lerp(a,b,t){ return a + (b-a)*t; }

// Persistent buffer holding written letters (never faded)
const glow = document.createElement("canvas");
const gctx = glow.getContext("2d");

// Offscreen sampling canvas
const off = document.createElement("canvas");
const offCtx = off.getContext("2d", { willReadFrequently:true });

// State
let letters = [];              // [{points:[]}]
let curL = 0;                  // letter index
let curIdx = 0;                // point index within current letter
let curT = 0;                  // fractional progress to next point [0..1)
let tip = null;                // current tip position {x,y}
let tail = [];                 // recent tip positions for beam tail

function splitLines(str, maxWidth, font){
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for(const word of words){
    const test = line ? (line + " " + word) : word;
    offCtx.font = font;
    if(offCtx.measureText(test).width <= maxWidth || !line){
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if(line) lines.push(line);
  return lines;
}

function buildLetters(){
  letters = [];
  const fs = clamp(Math.floor(w * CONFIG.fontScale), 30, 96);
  const font = `${CONFIG.fontWeight} ${fs}px ${CONFIG.fontFamily}`;
  const maxW = w * CONFIG.maxLineWidthRatio;
  const lines = splitLines(TEXT, maxW, font);
  const lh = fs * CONFIG.lineHeight;
  const totalH = lines.length * lh;

  offCtx.font = font;
  offCtx.textBaseline = "middle";
  offCtx.textAlign = "left";

  const startY = h/2 - (totalH - lh)/2;

  for(let li=0; li<lines.length; li++){
    const line = lines[li];
    const y = startY + li*lh;

    const lineW = offCtx.measureText(line).width;
    let x = (w - lineW)/2;

    for(const ch of line){
      const chW = offCtx.measureText(ch).width;

      if(ch === " "){
        x += chW;
        continue;
      }

      const pad = Math.ceil(fs*0.35);
      const boxW = Math.max(1, Math.ceil(chW + pad*2));
      const boxH = Math.max(1, Math.ceil(lh + pad*2));

      off.width = boxW;
      off.height = boxH;
      offCtx.setTransform(1,0,0,1,0,0);
      offCtx.clearRect(0,0,off.width,off.height);

      offCtx.fillStyle = "white";
      offCtx.font = font;
      offCtx.textAlign = "left";
      offCtx.textBaseline = "middle";
      offCtx.fillText(ch, pad, boxH/2);

      const img = offCtx.getImageData(0,0,off.width,off.height).data;
      const step = CONFIG.sampleStep;

      const pts = [];
      let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;

      for(let yy=0; yy<off.height; yy+=step){
        for(let xx=0; xx<off.width; xx+=step){
          const a = img[(yy*off.width + xx)*4 + 3];
          if(a > 12){
            const px = x + (xx - pad) + rnd(-0.25,0.25);
            const py = y + (yy - boxH/2) + rnd(-0.25,0.25);
            pts.push({x:px,y:py});
            if(px<minX) minX=px;
            if(py<minY) minY=py;
            if(px>maxX) maxX=px;
            if(py>maxY) maxY=py;
          }
        }
      }

      // Sort to create a smooth-ish trace path for each letter.
      // We do a simple "nearest-neighbor" chaining starting from top-left.
      if(pts.length > 2){
        // pick start: smallest y then x
        let start = 0;
        for(let i=1;i<pts.length;i++){
          if(pts[i].y < pts[start].y || (pts[i].y === pts[start].y && pts[i].x < pts[start].x)) start = i;
        }
        const ordered = [];
        const used = new Array(pts.length).fill(false);
        let cur = start;
        used[cur] = true;
        ordered.push(pts[cur]);

        for(let k=1;k<pts.length;k++){
          let best = -1;
          let bestD = 1e18;
          const cx = pts[cur].x, cy = pts[cur].y;
          // limited search window for speed: scan all (still ok for small letters)
          for(let j=0;j<pts.length;j++){
            if(used[j]) continue;
            const dx = pts[j].x - cx;
            const dy = pts[j].y - cy;
            const d = dx*dx + dy*dy;
            if(d < bestD){
              bestD = d; best = j;
            }
          }
          if(best === -1) break;
          used[best] = true;
          ordered.push(pts[best]);
          cur = best;
        }
        letters.push({ points: ordered });
      } else {
        letters.push({ points: pts });
      }

      x += chW;
    }
  }

  // Reset written buffer + draw state
  gctx.clearRect(0,0,w,h);
  curL = 0; curIdx = 0; curT = 0;
  tip = null;
  tail = [];
}

function resize(){
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  w = window.innerWidth;
  h = window.innerHeight;

  canvas.width = Math.max(1, Math.floor(w*dpr));
  canvas.height = Math.max(1, Math.floor(h*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);

  glow.width = Math.max(1, Math.floor(w*dpr));
  glow.height = Math.max(1, Math.floor(h*dpr));
  gctx.setTransform(dpr,0,0,dpr,0,0);
  gctx.clearRect(0,0,w,h);

  buildLetters();
}
window.addEventListener("resize", resize, { passive:true });
resize();

// Background
function drawBackground(t){
  ctx.fillStyle = "#050814";
  ctx.fillRect(0,0,w,h);

  const x1 = w*(0.25 + 0.08*Math.sin(t*0.0004));
  const y1 = h*(0.25 + 0.10*Math.cos(t*0.00035));
  const x2 = w*(0.78 + 0.06*Math.cos(t*0.00028));
  const y2 = h*(0.28 + 0.09*Math.sin(t*0.00031));
  const x3 = w*(0.55 + 0.08*Math.sin(t*0.00022));
  const y3 = h*(0.82 + 0.06*Math.cos(t*0.00027));

  const g1 = ctx.createRadialGradient(x1,y1, 10, x1,y1, Math.max(w,h)*0.55);
  g1.addColorStop(0, `rgba(80,140,255,${CONFIG.blobStrength})`);
  g1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g1; ctx.fillRect(0,0,w,h);

  const g2 = ctx.createRadialGradient(x2,y2, 10, x2,y2, Math.max(w,h)*0.52);
  g2.addColorStop(0, `rgba(210,80,255,${CONFIG.blobStrength*0.92})`);
  g2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g2; ctx.fillRect(0,0,w,h);

  const g3 = ctx.createRadialGradient(x3,y3, 10, x3,y3, Math.max(w,h)*0.60);
  g3.addColorStop(0, `rgba(70,255,210,${CONFIG.blobStrength*0.45})`);
  g3.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g3; ctx.fillRect(0,0,w,h);

  const vg = ctx.createRadialGradient(w*0.5,h*0.45, 10, w*0.5,h*0.45, Math.max(w,h)*0.85);
  vg.addColorStop(0, "rgba(255,255,255,0.03)");
  vg.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = vg; ctx.fillRect(0,0,w,h);
}

// Text writing
function burnPoint(p){
  gctx.save();
  gctx.globalCompositeOperation = "source-over";

  // hard dot
  gctx.fillStyle = rgba(CONFIG.textWhite, CONFIG.textHardAlpha);
  gctx.beginPath();
  gctx.arc(p.x,p.y, CONFIG.textDotRadius, 0, Math.PI*2);
  gctx.fill();

  // soft glow
  gctx.shadowColor = rgba(CONFIG.textWhite, 0.35);
  gctx.shadowBlur = CONFIG.textGlowRadius;
  gctx.fillStyle = rgba(CONFIG.textWhite, CONFIG.textSoftGlowAlpha);
  gctx.beginPath();
  gctx.arc(p.x,p.y, CONFIG.textDotRadius, 0, Math.PI*2);
  gctx.fill();

  gctx.restore();
}

function beamLine(a, b){
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // red outer
  ctx.shadowColor = rgba(CONFIG.beamRed, 0.60);
  ctx.shadowBlur = CONFIG.outerBlur;
  ctx.strokeStyle = rgba(CONFIG.beamRed, CONFIG.outerAlpha);
  ctx.lineWidth = CONFIG.outerWidth;
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

  // white mid
  ctx.shadowColor = rgba(CONFIG.textWhite, 0.55);
  ctx.shadowBlur = CONFIG.midBlur;
  ctx.strokeStyle = rgba(CONFIG.textWhite, CONFIG.midAlpha);
  ctx.lineWidth = CONFIG.midWidth;
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

  // bright core
  ctx.shadowColor = rgba(CONFIG.textWhite, 0.90);
  ctx.shadowBlur = CONFIG.coreBlur;
  ctx.strokeStyle = rgba(CONFIG.textWhite, CONFIG.coreAlpha);
  ctx.lineWidth = CONFIG.coreWidth;
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

  // hotspot at tip
  ctx.shadowColor = rgba(CONFIG.textWhite, 0.95);
  ctx.shadowBlur = CONFIG.hotspotGlow;
  ctx.fillStyle = rgba(CONFIG.textWhite, 0.90);
  ctx.beginPath(); ctx.arc(b.x,b.y, CONFIG.hotspotRadius, 0, Math.PI*2); ctx.fill();

  ctx.shadowColor = rgba(CONFIG.beamRed, 0.90);
  ctx.shadowBlur = CONFIG.hotspotGlow * 0.8;
  ctx.fillStyle = rgba(CONFIG.beamRed, 0.22);
  ctx.beginPath(); ctx.arc(b.x,b.y, CONFIG.hotspotRadius*2.6, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

function dist(a,b){
  const dx=a.x-b.x, dy=a.y-b.y;
  return Math.hypot(dx,dy);
}

function pushTail(p){
  if(!tail.length){
    tail.push({x:p.x,y:p.y});
    return;
  }
  const last = tail[tail.length-1];
  if(dist(last,p) >= CONFIG.tailStepMin){
    tail.push({x:p.x,y:p.y});
    if(tail.length > CONFIG.tailLength) tail.shift();
  }
}

function advanceTip(dt){
  // Find next drawable letter with points
  while(curL < letters.length && (!letters[curL].points || letters[curL].points.length < 2)){
    curL++; curIdx=0; curT=0; tip=null; tail=[];
  }
  if(curL >= letters.length) return;

  const pts = letters[curL].points;

  // initialize tip
  if(!tip){
    tip = {x: pts[0].x, y: pts[0].y};
    burnPoint(tip);
    pushTail(tip);
    curIdx = 0;
    curT = 0;
  }

  // move along path continuously
  let remaining = CONFIG.pointsPerSecond * dt; // in "point units"
  // We'll interpret "point units" as advancing along indices (not pixels)
  // and use interpolation for smoothness.
  while(remaining > 0 && curL < letters.length){
    const pts2 = letters[curL].points;
    if(curIdx >= pts2.length-1){
      // finish this letter
      curL++; curIdx=0; curT=0; tip=null; tail=[];
      // skip empties
      while(curL < letters.length && (!letters[curL].points || letters[curL].points.length < 2)){
        curL++;
      }
      if(curL >= letters.length) return;
      continue;
    }

    // consume fractional part
    const step = Math.min(1 - curT, remaining);
    curT += step;
    remaining -= step;

    const a = pts2[curIdx];
    const b = pts2[curIdx+1];
    const p = { x: lerp(a.x,b.x,curT), y: lerp(a.y,b.y,curT) };

    // burn along the segment for persistence (a few samples)
    burnPoint(p);
    tip = p;
    pushTail(p);

    if(curT >= 1){
      curIdx++;
      curT = 0;
    }
  }
}

// Render tail beam
function renderTail(){
  if(tail.length < 2) return;
  // draw from oldest to newest with slight fade
  for(let i=1;i<tail.length;i++){
    const a = tail[i-1];
    const b = tail[i];
    // fade factor
    const t = i / tail.length;
    // temporarily modulate alpha by t (newer brighter)
    ctx.save();
    const oa = CONFIG.outerAlpha * (0.35 + 0.65*t);
    const ma = CONFIG.midAlpha   * (0.35 + 0.65*t);
    const ca = CONFIG.coreAlpha  * (0.40 + 0.60*t);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    ctx.shadowColor = rgba(CONFIG.beamRed, 0.60);
    ctx.shadowBlur = CONFIG.outerBlur;
    ctx.strokeStyle = rgba(CONFIG.beamRed, oa);
    ctx.lineWidth = CONFIG.outerWidth;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

    ctx.shadowColor = rgba(CONFIG.textWhite, 0.55);
    ctx.shadowBlur = CONFIG.midBlur;
    ctx.strokeStyle = rgba(CONFIG.textWhite, ma);
    ctx.lineWidth = CONFIG.midWidth;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

    ctx.shadowColor = rgba(CONFIG.textWhite, 0.90);
    ctx.shadowBlur = CONFIG.coreBlur;
    ctx.strokeStyle = rgba(CONFIG.textWhite, ca);
    ctx.lineWidth = CONFIG.coreWidth;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

    ctx.restore();
  }

  // tip hotspot
  const b = tail[tail.length-1];
  const a = tail[tail.length-2];
  beamLine(a,b);
}

let last = performance.now();
function frame(t){
  const dt = Math.min(0.05, (t-last)/1000); // allow slightly larger dt without jumping
  last = t;

  drawBackground(t);

  // draw written text (persistent)
  ctx.drawImage(glow, 0,0, w,h);

  // advance and render continuous beam
  advanceTip(dt);
  renderTail();

  requestAnimationFrame(frame);
}

const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if(!reduced) requestAnimationFrame(frame);
else {
  drawBackground(performance.now());
  // Render static text directly onto main canvas
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fs = clamp(Math.floor(w * CONFIG.fontScale), 30, 96);
  const font = `${CONFIG.fontWeight} ${fs}px ${CONFIG.fontFamily}`;
  offCtx.font = font;
  ctx.font = font;
  const lines = splitLines(TEXT, w * CONFIG.maxLineWidthRatio, font);
  const lh = fs * CONFIG.lineHeight;
  const totalH = lines.length * lh;
  const startY = h/2 - (totalH - lh)/2;
  for(let i=0;i<lines.length;i++){
    ctx.fillText(lines[i], w/2, startY + i*lh);
  }
}
