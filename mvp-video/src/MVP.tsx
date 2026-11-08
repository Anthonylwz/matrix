import React from 'react';
import {AbsoluteFill, Img, interpolate, Easing, random, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

const BLUE = '#2fb8ff';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Jagged tapered blade polygon along a diagonal, in a 1000x1000 space.
const slashPath = (i: number) => {
  const off = (i - 1) * 210;
  const x0 = 180 + off, y0 = 900, x1 = 820 + off, y1 = 100;
  const n = 28, top: string[] = [], bot: string[] = [];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const w = Math.sin(Math.PI * t) ** 0.7 * 46;
    const j1 = (random(`a${i}${k}`) - 0.5) * 16, j2 = (random(`b${i}${k}`) - 0.5) * 16;
    const px = x0 + dx * t, py = y0 + dy * t;
    top.push(`${px + nx * (w + j1)},${py + ny * (w + j1)}`);
    bot.unshift(`${px - nx * (w + j2)},${py - ny * (w + j2)}`);
  }
  return `M${top.join(' L')} L${bot.join(' L')} Z`;
};
const SLASHES = [0, 1, 2].map(slashPath);

// Claw layer: z = 0 far (tiny), 1 at the lens (huge, blurred).
const Claws: React.FC<{z: number; glow: number}> = ({z, glow}) => {
  const s = 0.15 + Math.pow(z, 2.2) * 9;
  const blur = Math.max(0, (z - 0.55) * 40);
  return (
    <AbsoluteFill style={{transform: `scale(${s}) rotate(${-8 + z * 10}deg)`, filter: `blur(${blur}px)`}}>
      <svg viewBox="0 0 1000 1000" style={{width: '100%', height: '100%', overflow: 'visible'}} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="edge" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#0a1a3a" />
            <stop offset="0.5" stopColor="#bff0ff" />
            <stop offset="1" stopColor="#0a1a3a" />
          </linearGradient>
        </defs>
        {SLASHES.map((d, i) => (
          <g key={i} style={{filter: `drop-shadow(0 0 ${8 + glow * 20}px ${BLUE}) drop-shadow(0 0 4px #fff)`}}>
            <path d={d} fill="#02040a" stroke="url(#edge)" strokeWidth={5} />
          </g>
        ))}
      </svg>
    </AbsoluteFill>
  );
};

// Scene seen through the slash "wound": mask scale grows from 0 to fully open.
const Revealed: React.FC<{open: number; children: React.ReactNode}> = ({open, children}) => {
  const s = 0.2 + Math.pow(open, 2) * 14;
  if (open <= 0) return null;
  return (
    <AbsoluteFill>
      <svg width="0" height="0">
        <defs>
          <mask id="wound" maskContentUnits="objectBoundingBox">
            <g transform={`translate(0.5 0.5) scale(${s / 1000}) translate(-500 -500)`}>
              {SLASHES.map((d, i) => <path key={i} d={d} fill="white" />)}
            </g>
          </mask>
        </defs>
      </svg>
      <AbsoluteFill style={{mask: open >= 1 ? undefined : 'url(#wound)', WebkitMask: open >= 1 ? undefined : 'url(#wound)'}}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Particles: React.FC<{f: number; strength: number}> = ({f, strength}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill>
      {new Array(70).fill(0).map((_, i) => {
        const sp = 0.4 + random(`s${i}`) * 1.4;
        const x = random(`x${i}`) * width + Math.sin(f / 25 + i) * 20;
        const y = ((random(`y${i}`) * height - f * sp * 2) % height + height) % height;
        const r = 2 + random(`r${i}`) * 5;
        const tw = 0.5 + 0.5 * Math.sin(f / 6 + i * 3);
        return <div key={i} style={{position: 'absolute', left: x, top: y, width: r, height: r, borderRadius: r,
          background: '#aef', boxShadow: `0 0 ${r * 4}px ${BLUE}`, opacity: strength * tw}} />;
      })}
    </AbsoluteFill>
  );
};

const Lightning: React.FC<{f: number}> = ({f}) => {
  const pts: string[] = [];
  let x = 500;
  for (let y = 0; y <= 1000; y += 50) { x += (random(`l${y}${Math.floor(f / 2)}`) - 0.5) * 120; pts.push(`${x},${y}`); }
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
      <polyline points={pts.join(' ')} fill="none" stroke="#fff" strokeWidth={6} style={{filter: `drop-shadow(0 0 20px ${BLUE}) drop-shadow(0 0 50px ${BLUE})`}} />
    </svg>
  );
};

const Name: React.FC<{f: number}> = ({f}) => {
  const {width, height} = useVideoConfig();
  const vertical = height > width;
  const fs = vertical ? width * 0.1 : height * 0.17;
  const t = interpolate(f, [255, 290], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const letters = '[Cristhian_J]'.split('');
  const bolt = interpolate(f, [282, 286, 300], [0, 1, 0.85], clamp);
  return (
    <AbsoluteFill style={{justifyContent: vertical ? 'flex-end' : 'flex-end', alignItems: 'center', paddingBottom: vertical ? height * 0.14 : height * 0.08}}>
      <div style={{display: 'flex', alignItems: 'center', fontFamily: 'Impact, "Arial Black", sans-serif', fontWeight: 900, fontSize: fs, letterSpacing: fs * 0.02}}>
        {letters.map((c, i) => {
          const li = interpolate(t * letters.length * 1.6 - i, [0, 1], [0, 1], clamp);
          return (
            <span key={i} style={{
              display: 'inline-block',
              transform: `translateZ(0) translateY(${(1 - li) * 60}px) scale(${2.4 - li * 1.4}) rotateX(${(1 - li) * 70}deg)`,
              opacity: li,
              filter: `blur(${(1 - li) * 12}px) drop-shadow(0 0 ${6 + 10 * li}px ${BLUE}) drop-shadow(0 6px 4px #000)`,
              background: 'linear-gradient(180deg,#e8eef5 0%,#5b6675 38%,#1a2029 52%,#7d8896 70%,#2a313b 100%)',
              WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextStroke: `${fs * 0.018}px #8fdcff`,
            }}>{c}</span>
          );
        })}
        <span style={{fontSize: fs * 1.1, marginLeft: fs * 0.08, opacity: bolt, color: '#ffcf3a',
          filter: `drop-shadow(0 0 ${10 + bolt * 40}px #ffd54a) drop-shadow(0 0 30px ${BLUE})`, transform: `scale(${1 + (bolt > 0.95 ? 0.15 : 0)})`}}>⚡</span>
      </div>
    </AbsoluteFill>
  );
};

export const MVP: React.FC = () => {
  const f = useCurrentFrame();
  const {width, height, durationInFrames: D} = useVideoConfig();
  const vertical = height > width;

  // Entry: claws fly from depth to lens (0–96), wound opens (60–150)
  const zIn = interpolate(f, [4, 96], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const openIn = interpolate(f, [55, 150], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  // Close: claws from lens back to depth (300–350), wound closes
  const zOut = interpolate(f, [300, 348], [1, 0], {...clamp, easing: Easing.out(Easing.cubic)});
  const openOut = interpolate(f, [300, 346], [1, 0], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const open = f < 225 ? openIn : openOut;
  const z = f < 225 ? zIn : zOut;
  const clawVisible = (f > 2 && f < 100) || (f > 298 && f < D - 4);
  const clawFade = f < 225 ? interpolate(f, [2, 10, 90, 100], [0, 1, 1, 0], clamp) : interpolate(f, [298, 304, 340, D - 4], [0, 1, 1, 0], clamp);

  // Camera: push-in, slow orbit with parallax, shake when claws pass lens
  const push = interpolate(f, [96, 160], [1.25, 1.05], {...clamp, easing: Easing.out(Easing.cubic)});
  const orbit = interpolate(f, [150, 300], [0, 1], clamp);
  const ang = Math.sin(orbit * Math.PI) * 1;
  const shakeAmt = Math.max(interpolate(f, [80, 92, 110], [0, 1, 0], clamp), interpolate(f, [298, 306, 320], [0, 1, 0], clamp));
  const sx = (random(`sx${f}`) - 0.5) * 30 * shakeAmt, sy = (random(`sy${f}`) - 0.5) * 30 * shakeAmt;
  const breath = 1 + Math.sin(f / 30 * Math.PI * 0.9) * 0.008;
  const flash = interpolate(f, [282, 285, 294], [0, 0.55, 0], clamp);
  const power = interpolate(f, [140, 180], [0, 1], clamp) * interpolate(f, [300, 330], [1, 0], clamp);

  // Image framing: cat centered; vertical crops tighter on the cat
  const imgW = vertical ? height * 0.62 * (1080 / 456) : width;
  const bgPan = ang * (vertical ? 40 : 60);

  return (
    <AbsoluteFill style={{background: '#000', overflow: 'hidden'}}>
      <Revealed open={open}>
        <AbsoluteFill style={{transform: `translate(${sx}px,${sy}px) scale(${push})`}}>
          {/* Deep background layer: blurred, moves more (parallax) */}
          <AbsoluteFill style={{transform: `translateX(${-bgPan * 1.6}px) scale(1.25)`, filter: 'blur(14px) brightness(0.55) saturate(1.3)'}}>
            <Img src={staticFile('cat.jpg')} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          </AbsoluteFill>
          {/* Main plate with breathing + orbit */}
          <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center',
            transform: `translateX(${bgPan}px) rotate(${ang * 0.8}deg) scale(${breath})`}}>
            <Img src={staticFile('cat.jpg')} style={{width: imgW, maxWidth: 'none', flexShrink: 0, height: 'auto', marginTop: vertical ? -height*0.12 : -height*0.1,
              maskImage: 'linear-gradient(180deg,transparent 0%,#000 12%,#000 70%,transparent 100%)', WebkitMaskImage: 'linear-gradient(180deg,transparent 0%,#000 12%,#000 70%,transparent 100%)',
              filter: `contrast(1.08) saturate(1.1) brightness(${1 + flash})`}} />
          </AbsoluteFill>
          {/* Power field */}
          <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 45%, rgba(47,184,255,${0.18 * power}) 0%, transparent 55%)`, mixBlendMode: 'screen'}} />
          <Particles f={f} strength={power} />
          {/* Volumetric key light */}
          <AbsoluteFill style={{background: 'linear-gradient(160deg, rgba(200,230,255,0.22) 0%, transparent 35%)', mixBlendMode: 'screen'}} />
          <Name f={f} />
          {f >= 282 && f < 292 && <Lightning f={f} />}
          {/* Cinematic vignette + bars of black */}
          <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)'}} />
        </AbsoluteFill>
      </Revealed>
      {clawVisible && (
        <AbsoluteFill style={{opacity: clawFade, transform: `translate(${sx}px,${sy}px)`}}>
          <Claws z={z} glow={z} />
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{background: '#fff', opacity: flash * 0.6, mixBlendMode: 'screen'}} />
    </AbsoluteFill>
  );
};
