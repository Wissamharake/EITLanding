// Fullscreen screensaver: drifting particles + laser-drawn text on canvas.
// Text requested:
const TEXT = "Welcome to Electrical & Instrumentation Dashboard";

// Tuning
const CONFIG = {
  particleCount: 160,
  particleMaxSpeed: 0.65,
  linkDistance: 120,

  // Laser draw
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  fontWeight: 650,
  // target font size is computed from screen width; this is a multiplier
  fontScale: 0.090,        // bigger -> larger text
  lineHeight: 1.15,

  // Sampling density: smaller step = more points (heavier)
  sampleStep: 4,           // pixels
  revealRate: 900,         // points per second revealed
  sweepSpeed: 1200,        // px/sec for scanning beam effect

  // Colors
  laserWhite: [255, 255, 255],
  laserRed:   [255, 64,  64],
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

let w=0,h=0,dpr=1;

function resize(){
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  w = canvas.clientWidth = window.innerWidth;
  h = canvas.clientHeight = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  buildTextPoints();
}
window.addEventListener("resize", resize, { passive:true });

function rnd(a,b){ return a + Math.random()*(b-a); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function mix(a,b,t){ return a + (b-a)*t; }

resize();

// ---------- Background particles ----------
const particles = [];
function initParticles(){
  particles.length = 0;
  for(let i=0;i<CONFIG.particleCount;i++){
    particles.push({
      x: rnd(0,w),
      y: rnd(0,h),
      vx: rnd(-CONFIG.particleMaxSpeed, CONFIG.particleMaxSpeed),
      vy: rnd(-CONFIG.particleMaxSpeed, CONFIG.particleMaxSpeed),
      r: rnd(1.0, 2.3),
      hue: rnd(190, 320),
    });
  }
}
initParticles();

// ---------- Text sampling ----------
let textPoints = [];
let revealCount = 0;
let textBounds = null;

const off = document.createElement("canvas");
const offCtx = off.getContext("2d", { willReadFrequently: true });

function splitLines(str, maxWidth, font){
  // basic greedy wrap
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

function buildTextPoints(){
  // Prepare offscreen
  off.width = Math.floor(w);
  off.height = Math.floor(h);
  offCtx.setTransform(1,0,0,1,0,0);
  offCtx.clearRect(0,0,off.width,off.height);

  // Font size based on viewport
  const fs = clamp(Math.floor(w * CONFIG.fontScale), 34, 110);
  const font = `${CONFIG.fontWeight} ${fs}px ${CONFIG.fontFamily}`;

  // Wrap text to fit ~80% width
  const maxW = w * 0.82;
  const lines = splitLines(TEXT, maxW, font);

  // Compute total height
  const lh = fs * CONFIG.lineHeight;
  const totalH = lines.length * lh;

  // Draw centered
  const cx = w/2;
  const cy = h/2;

  offCtx.fillStyle = "white";
  offCtx.textAlign = "center";
  offCtx.textBaseline = "middle";
  offCtx.font = font;

  const startY = cy - (totalH - lh)/2;
  for(let i=0;i<lines.length;i++){
    const y = startY + i*lh;
    offCtx.fillText(lines[i], cx, y);
  }

  const img = offCtx.getImageData(0,0,off.width,off.height).data;
  const step = CONFIG.sampleStep;

  const pts = [];
  let minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;

  for(let y=0;y<off.height;y+=step){
    for(let x=0;x<off.width;x+=step){
      const a = img[(y*off.width + x)*4 + 3];
      if(a > 12){
        // jitter slightly to avoid grid look
        const jx = x + rnd(-0.6, 0.6);
        const jy = y + rnd(-0.6, 0.6);
        pts.push({x:jx,y:jy});
        if(jx<minX) minX=jx;
        if(jy<minY) minY=jy;
        if(jx>maxX) maxX=jx;
        if(jy>maxY) maxY=jy;
      }
    }
  }

  // Sort points in a "scanline" order so the laser looks like it's drawing
  pts.sort((p,q)=>{
    const by = Math.floor(p.y/step) - Math.floor(q.y/step);
    if(by !== 0) return by;
    // alternate direction each row for a continuous sweep
    const row = Math.floor(p.y/step);
    return (row % 2 === 0) ? (p.x - q.x) : (q.x - p.x);
  });

  textPoints = pts;
  revealCount = 0;
  textBounds = {minX, minY, maxX, maxY, fs};
}
buildTextPoints();

// ---------- Laser + glow buffer ----------
const glow = document.createElement("canvas");
const gctx = glow.getContext("2d");
function resizeGlow(){
  glow.width = Math.floor(w * dpr);
  glow.height = Math.floor(h * dpr);
  gctx.setTransform(dpr,0,0,dpr,0,0);
  gctx.clearRect(0,0,w,h);
}
resizeGlow();

window.addEventListener("resize", resizeGlow, { passive:true });

// Keep a persistent "engraved" / burned-in look by slowly fading the glow buffer.
function fadeGlow(){
  gctx.fillStyle = "rgba(5,8,20,0.06)"; // low alpha = slow decay
  gctx.fillRect(0,0,w,h);
}

// Convert rgb array + alpha to rgba string
function rgba(rgb, a){ return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

// ---------- Animation state ----------
let last = performance.now();
let sweepX = 0;
let sweepDir = 1;
let completedAt = 0;

function step(now){
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // Background
  ctx.fillStyle = "#050814";
  ctx.fillRect(0,0,w,h);

  // vignette
  const vg = ctx.createRadialGradient(w*0.5,h*0.45, 10, w*0.5,h*0.45, Math.max(w,h)*0.78);
  vg.addColorStop(0, "rgba(255,255,255,0.03)");
  vg.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = vg;
  ctx.fillRect(0,0,w,h);

  // move particles
  for(const p of particles){
    p.x += p.vx; p.y += p.vy;
    if(p.x < -20) p.x = w + 20;
    if(p.x > w + 20) p.x = -20;
    if(p.y < -20) p.y = h + 20;
    if(p.y > h + 20) p.y = -20;
  }

  // links
  for(let i=0;i<particles.length;i++){
    const a = particles[i];
    for(let j=i+1;j<particles.length;j++){
      const b = particles[j];
      const dx=a.x-b.x, dy=a.y-b.y;
      const dist = Math.hypot(dx,dy);
      if(dist < CONFIG.linkDistance){
        const t = 1 - dist/CONFIG.linkDistance;
        ctx.strokeStyle = `rgba(190,210,255,${0.16*t})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x,a.y);
        ctx.lineTo(b.x,b.y);
        ctx.stroke();
      }
    }
  }

  // particles
  for(const p of particles){
    ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, 0.72)`;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, 0.06)`;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.r*6.2,0,Math.PI*2);
    ctx.fill();
  }

  // Fade glow buffer slightly, then add new revealed points
  fadeGlow();

  // Reveal points over time
  if(textPoints.length){
    const add = Math.floor(CONFIG.revealRate * dt);
    revealCount = Math.min(textPoints.length, revealCount + add);
  }

  // Draw revealed points into glow buffer (white core + red fringe)
  for(let i=Math.max(0, revealCount - 2500); i<revealCount; i++){ // only draw recent batch for performance
    const p = textPoints[i];
    // core
    gctx.fillStyle = rgba(CONFIG.laserWhite, 0.55);
    gctx.beginPath();
    gctx.arc(p.x,p.y, 0.85, 0, Math.PI*2);
    gctx.fill();

    // red tint halo
    gctx.fillStyle = rgba(CONFIG.laserRed, 0.12);
    gctx.beginPath();
    gctx.arc(p.x,p.y, 3.6, 0, Math.PI*2);
    gctx.fill();
  }

  // Composite glow buffer onto main canvas
  ctx.drawImage(glow, 0,0, w,h);

  // Laser "shooting" sweep line (white + red)
  if(textBounds){
    const minX = textBounds.minX - 40;
    const maxX = textBounds.maxX + 40;
    const range = (maxX - minX) || 1;

    // Move sweep
    sweepX += sweepDir * CONFIG.sweepSpeed * dt;
    if(sweepX > range){
      sweepX = range; sweepDir = -1;
    } else if(sweepX < 0){
      sweepX = 0; sweepDir = 1;
    }

    const x = minX + sweepX;

    // Only show strong laser while revealing
    const progress = revealCount / (textPoints.length || 1);
    const active = progress < 1 ? 1 : 0.35;

    // glow beam
    ctx.strokeStyle = `rgba(255,255,255,${0.10*active})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, textBounds.minY-30);
    ctx.lineTo(x, textBounds.maxY+30);
    ctx.stroke();

    // red inner beam
    ctx.strokeStyle = `rgba(255,64,64,${0.18*active})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, textBounds.minY-30);
    ctx.lineTo(x, textBounds.maxY+30);
    ctx.stroke();

    // hotspot at intersection with the "current" row based on progress
    const idx = Math.min(textPoints.length-1, Math.floor(revealCount));
    if(idx >= 0 && textPoints[idx]){
      const hp = textPoints[idx];
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 4.2, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,64,64,0.22)";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 12, 0, Math.PI*2);
      ctx.fill();
    }

    // When fully revealed, keep a gentle shimmer and occasionally restart
    if(progress >= 1){
      if(!completedAt) completedAt = now;
      const since = (now - completedAt)/1000;
      // subtle shimmer
      const shimmer = 0.06 + 0.04*Math.sin(now/900);
      ctx.fillStyle = `rgba(120,200,255,${shimmer})`;
      ctx.fillRect(textBounds.minX-8, textBounds.minY-8, (textBounds.maxX-textBounds.minX)+16, (textBounds.maxY-textBounds.minY)+16);

      if(since > 14){
        // restart the "laser drawing" cycle
        revealCount = 0;
        completedAt = 0;
        gctx.clearRect(0,0,w,h);
      }
    } else {
      completedAt = 0;
    }
  }

  requestAnimationFrame(step);
}

const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if(!reduced) requestAnimationFrame(step);
else {
  // Draw a static frame for reduced motion users
  ctx.fillStyle = "#050814";
  ctx.fillRect(0,0,w,h);
  // draw text plainly
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fs = clamp(Math.floor(w * CONFIG.fontScale), 34, 110);
  ctx.font = `${CONFIG.fontWeight} ${fs}px ${CONFIG.fontFamily}`;
  ctx.fillText(TEXT, w/2, h/2);
}
