// Screensaver-style particle field + "Welcome" overlay.
// Customize easily:
const CONFIG = {
  particleCount: 170,
  maxSpeed: 0.7,
  linkDistance: 120,
  glowStrength: 0.9,
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

let w, h, dpr;
function resize(){
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  w = canvas.clientWidth = window.innerWidth;
  h = canvas.clientHeight = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", resize, { passive:true });
resize();

function rnd(a,b){ return a + Math.random()*(b-a); }

const particles = [];
function init(){
  particles.length = 0;
  for(let i=0;i<CONFIG.particleCount;i++){
    particles.push({
      x: rnd(0,w),
      y: rnd(0,h),
      vx: rnd(-CONFIG.maxSpeed, CONFIG.maxSpeed),
      vy: rnd(-CONFIG.maxSpeed, CONFIG.maxSpeed),
      r: rnd(1.1, 2.4),
      hue: rnd(190, 320),
    });
  }
}
init();

function step(){
  // background with subtle vignette
  ctx.fillStyle = "#050814";
  ctx.fillRect(0,0,w,h);

  const g = ctx.createRadialGradient(w*0.5,h*0.4, 10, w*0.5,h*0.4, Math.max(w,h)*0.75);
  g.addColorStop(0, "rgba(255,255,255,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);

  // move
  for(const p of particles){
    p.x += p.vx;
    p.y += p.vy;

    // wrap
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
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx,dy);
      if(dist < CONFIG.linkDistance){
        const t = 1 - (dist / CONFIG.linkDistance);
        ctx.strokeStyle = `rgba(190,210,255,${0.18*t})`;
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
    const alpha = 0.75;
    ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fill();

    // glow
    ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${0.08*CONFIG.glowStrength})`;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.r*6.5,0,Math.PI*2);
    ctx.fill();
  }

  requestAnimationFrame(step);
}

const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if(!reduced) step();
else {
  // draw a single frame for reduced motion users
  for(let k=0;k<2;k++) step();
}
